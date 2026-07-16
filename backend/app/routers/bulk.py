import csv
import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Identity, Project, Task
from app.routers.deps import get_project_or_404
from app.schemas import (
    BulkActionResult,
    BulkTaskUpdate,
    TaskImportItem,
    TaskImportRequest,
    TaskImportResult,
)
from app.services import graph
from app.services.activity import log_activity
from app.services.ical_token import verify_global_ical_token
from app.services.ws_manager import ws_manager

router = APIRouter()

# ---------------------------------------------------------------------------
# 1. Bulk Update
# ---------------------------------------------------------------------------

_TASK_EXPORT_FIELDS = [
    "title",
    "description",
    "status",
    "priority",
    "assignee",
    "due_date",
    "start_date",
    "time_estimate",
    "time_spent",
]


def _ical_escape(text: str) -> str:
    """Escape reserved characters in an iCalendar TEXT value (RFC 5545 §3.3.11)."""
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ical_fold(line: str) -> str:
    """Fold a content line to <=75 octets per RFC 5545 §3.1.

    Continuation lines start with a single space. Folding is done on UTF-8 octet
    boundaries (never mid-character) so multibyte titles (e.g. CJK) stay valid and
    parse identically on Apple and Google.
    """
    if len(line.encode("utf-8")) <= 75:
        return line
    chunks: list[bytes] = []
    current = b""
    for ch in line:
        encoded = ch.encode("utf-8")
        # First line fits 75 octets; continuation lines reserve 1 for the leading space.
        limit = 75 if not chunks else 74
        if len(current) + len(encoded) > limit:
            chunks.append(current)
            current = b""
        current += encoded
    chunks.append(current)
    return "\r\n ".join(c.decode("utf-8") for c in chunks)


def _ical_dt(dt: datetime) -> str:
    """Format a datetime as an iCalendar UTC timestamp (e.g. 20260711T140000Z)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _aware(dt: datetime) -> datetime:
    """Treat naive datetimes (as returned by SQLite) as UTC for comparisons."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


@router.post(
    "/projects/{project_id}/tasks/bulk-update",
    response_model=BulkActionResult,
    tags=["tasks"],
)
async def bulk_update_tasks(
    project_id: str,
    body: BulkTaskUpdate,
    db: Session = Depends(get_db),
):
    project = get_project_or_404(project_id, db)

    if len(body.task_ids) > 500:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Bulk update limited to 500 tasks per request")

    tasks = db.query(Task).filter(Task.project_id == project_id, Task.id.in_(body.task_ids)).all()

    updated_ids: list[str] = []

    for task in tasks:
        if body.status is not None:
            task.status = body.status
        if body.priority is not None:
            task.priority = body.priority
        if body.assignee is not None:
            task.assignee = body.assignee
        if body.is_pinned is not None:
            task.is_pinned = body.is_pinned

        # Add labels
        for label_id in body.add_label_ids:
            graph.set_label(db, task.id, label_id)

        # Remove labels
        for label_id in body.remove_label_ids:
            graph.unset_label(db, task.id, label_id)

        updated_ids.append(task.id)

    changes: list[str] = []
    if body.status is not None:
        changes.append(f"status={body.status}")
    if body.priority is not None:
        changes.append(f"priority={body.priority}")
    if body.assignee is not None:
        changes.append(f"assignee={body.assignee}")
    if body.is_pinned is not None:
        changes.append(f"is_pinned={body.is_pinned}")
    if body.add_label_ids:
        changes.append(f"added {len(body.add_label_ids)} label(s)")
    if body.remove_label_ids:
        changes.append(f"removed {len(body.remove_label_ids)} label(s)")

    log_activity(
        db,
        "task.bulk_updated",
        project_id=project_id,
        task_id=None,
        actor=None,
        detail=f"Bulk updated {len(updated_ids)} task(s) in {project.name}: {', '.join(changes)}",
        meta={"task_ids": updated_ids, "changes": changes},
    )

    db.commit()

    await ws_manager.broadcast(
        "task.bulk_updated",
        {"project_id": project_id, "task_ids": updated_ids},
    )

    return BulkActionResult(updated=len(updated_ids), task_ids=updated_ids)


# ---------------------------------------------------------------------------
# 2. Export Tasks
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/tasks/export",
    tags=["tasks"],
)
def export_tasks(
    project_id: str,
    format: Literal["json", "csv"] = Query("json"),
    db: Session = Depends(get_db),
):
    get_project_or_404(project_id, db)

    tasks = (
        db.query(Task).filter(Task.project_id == project_id).order_by(Task.position.asc(), Task.created_at.asc()).all()
    )

    rows = []
    for t in tasks:
        rows.append(
            {
                "title": t.title,
                "description": t.description or "",
                "status": t.status,
                "priority": t.priority,
                "assignee": t.assignee or "",
                "due_date": t.due_date.isoformat() if t.due_date else "",
                "start_date": t.start_date.isoformat() if t.start_date else "",
                "time_estimate": t.time_estimate if t.time_estimate is not None else "",
                "time_spent": t.time_spent if t.time_spent is not None else "",
            }
        )

    if format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_TASK_EXPORT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=tasks-{project_id}.csv"},
        )

    return rows


# ---------------------------------------------------------------------------
# 3. Import Tasks
# ---------------------------------------------------------------------------


def _create_task_recursive(
    db: Session,
    project_id: str,
    item: TaskImportItem,
    parent_id: str | None,
    created_ids: list[str],
) -> None:
    task = Task(
        id=str(uuid.uuid4()),
        project_id=project_id,
        parent_id=parent_id,
        title=item.title,
        description=item.description,
        status=item.status,
        priority=item.priority,
        assignee=item.assignee,
        due_date=item.due_date,
        start_date=item.start_date,
        time_estimate=item.time_estimate,
        time_spent=item.time_spent,
    )
    db.add(task)
    db.flush()
    created_ids.append(task.id)

    for sub in item.subtasks:
        _create_task_recursive(db, project_id, sub, task.id, created_ids)


@router.post(
    "/projects/{project_id}/tasks/import",
    response_model=TaskImportResult,
    tags=["tasks"],
)
async def import_tasks(
    project_id: str,
    body: TaskImportRequest,
    db: Session = Depends(get_db),
):
    project = get_project_or_404(project_id, db)

    created_ids: list[str] = []
    for item in body.tasks:
        _create_task_recursive(db, project_id, item, None, created_ids)

    log_activity(
        db,
        "task.imported",
        project_id=project_id,
        task_id=None,
        actor=None,
        detail=f"Imported {len(created_ids)} task(s) into {project.name}",
        meta={"task_ids": created_ids},
    )

    db.commit()

    await ws_manager.broadcast(
        "task.imported",
        {"project_id": project_id, "task_ids": created_ids},
    )

    return TaskImportResult(imported=len(created_ids), task_ids=created_ids)


# ---------------------------------------------------------------------------
# 4. iCal Feeds
# ---------------------------------------------------------------------------
#
# Three scoped feeds, all read-only and unauthenticated at the middleware layer
# (calendar clients cannot log in), so each is gated by an unguessable token:
#   - /ical/all/{token}.ics       personal, every project (global token, see below)
#   - /ical/identity/{token}.ics  everything under one identity (Identity.share_token)
#   - /ical/project/{token}.ics   a single project (Project.share_token)
# The identity/project feeds reuse the same share_token as their /share/ page, so a
# calendar and its share page are revoked together (see ADR-0023).

_ALARM_QUERY = Query(
    30,
    ge=0,
    le=10080,
    description="Reminder lead time in minutes before the due date; 0 disables reminders.",
)


def _render_calendar(calname: str, tasks: list[Task], alarm: int) -> PlainTextResponse:
    stamp = _ical_dt(datetime.now(UTC))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Shard//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ical_escape(calname)}",
    ]

    for t in tasks:
        due = _aware(t.due_date)
        start = _aware(t.start_date) if (t.start_date and _aware(t.start_date) < due) else due
        end = due if start < due else start + timedelta(minutes=30)
        # No STATUS field: the VTODO-style values we used are invalid on a VEVENT,
        # and STATUS:CANCELLED can hide/strike events inconsistently across clients.
        # Every task is emitted as a plain event so Apple and Google render it the same.
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{t.id}@shard",
                f"DTSTAMP:{stamp}",
                f"DTSTART:{_ical_dt(start)}",
                f"DTEND:{_ical_dt(end)}",
                f"SUMMARY:{_ical_escape(t.title)}",
                f"DESCRIPTION:{_ical_escape(t.description or '')}",
                f"LAST-MODIFIED:{_ical_dt(_aware(t.updated_at))}",
            ]
        )

        # Only remind for work that is still open.
        if alarm > 0 and t.status not in ("done", "failed"):
            lines.extend(
                [
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_ical_escape(t.title)}",
                    f"TRIGGER:-PT{alarm}M",
                    "END:VALARM",
                ]
            )

        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    body = "\r\n".join(_ical_fold(ln) for ln in lines) + "\r\n"
    return PlainTextResponse(content=body, media_type="text/calendar")


@router.get("/ical/all/{token}.ics", tags=["ical"], response_class=PlainTextResponse)
def ical_feed_all(token: str, alarm: int = _ALARM_QUERY, db: Session = Depends(get_db)):
    """Personal feed: every due-dated task across all projects (global token)."""
    if not verify_global_ical_token(db, token):
        raise HTTPException(status_code=404, detail="Calendar not found")
    tasks = db.query(Task).filter(Task.due_date.isnot(None)).all()
    return _render_calendar("All tasks", tasks, alarm)


@router.get("/ical/identity/{token}.ics", tags=["ical"], response_class=PlainTextResponse)
def ical_feed_identity(token: str, alarm: int = _ALARM_QUERY, db: Session = Depends(get_db)):
    """Shared feed: every due-dated task across one identity's projects."""
    identity = db.query(Identity).filter(Identity.share_token == token).first()
    if identity is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    project_ids = [pi.project_id for pi in identity.project_identities]
    tasks = (
        db.query(Task).filter(Task.project_id.in_(project_ids), Task.due_date.isnot(None)).all() if project_ids else []
    )
    return _render_calendar(identity.name, tasks, alarm)


@router.get("/ical/project/{token}.ics", tags=["ical"], response_class=PlainTextResponse)
def ical_feed_project(token: str, alarm: int = _ALARM_QUERY, db: Session = Depends(get_db)):
    """Shared feed: a single project's due-dated tasks (same token as its share page)."""
    project = db.query(Project).filter(Project.share_token == token).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    tasks = db.query(Task).filter(Task.project_id == project.id, Task.due_date.isnot(None)).all()
    return _render_calendar(project.name, tasks, alarm)
