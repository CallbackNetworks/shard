import csv
import io
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Node
from app.routers.deps import get_project_or_404
from app.schemas import (
    BulkActionResult,
    BulkTaskUpdate,
    TaskImportRequest,
    TaskImportResult,
)
from app.services import graph, task_transfer
from app.services.activity import log_activity
from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed
from app.services.ical_token import verify_global_ical_token
from app.services.task_mutations import apply_task_update
from app.services.ws_manager import ws_manager

router = APIRouter()
# iCal feeds are external contracts (calendar apps subscribe by URL) and must stay
# at the root path, not under /api like the SPA-facing bulk routes (ADR-0036).
ical_router = APIRouter()

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

    contained = set(graph.contained_task_ids(db, project_id))
    ids = [tid for tid in body.task_ids if tid in contained]

    field_changes: dict = {}
    if body.status is not None:
        field_changes["status"] = body.status
    if body.priority is not None:
        field_changes["priority"] = body.priority
    if body.assignee is not None:
        field_changes["assignee"] = body.assignee
    if body.is_pinned is not None:
        field_changes["is_pinned"] = body.is_pinned

    updated_ids: list[str] = []
    for tid in ids:
        for label_id in body.add_label_ids:
            if label_id not in graph.label_ids_for_task(db, tid):
                graph.set_label(db, tid, label_id)
                await dispatch_edge_added(
                    db, tid, label_id, graph.REL_LABELED, actor="bulk", commit=False, broadcast=False
                )
        for label_id in body.remove_label_ids:
            if graph.unset_label(db, tid, label_id):
                await dispatch_edge_removed(
                    db, tid, label_id, graph.REL_LABELED, actor="bulk", commit=False, broadcast=False
                )
        if field_changes:
            # Full pipeline per task (rules, notifications, activity); the
            # aggregate broadcast below replaces per-task ws events.
            await apply_task_update(db, tid, dict(field_changes), source="bulk", project_id=project_id, broadcast=False)
        updated_ids.append(tid)

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
    rows = task_transfer.export_rows(db, project_id)
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
    created_ids = await task_transfer.import_tasks(db, project_id, body.tasks, actor=None)
    await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": created_ids})
    return TaskImportResult(imported=len(created_ids), task_ids=created_ids)


# ---------------------------------------------------------------------------
# 4. iCal Feeds
# ---------------------------------------------------------------------------
#
# Three scoped feeds, all read-only and unauthenticated at the middleware layer
# (calendar clients cannot log in), so each is gated by an unguessable token:
#   - /ical/all/{token}.ics       personal, every project (global token, see below)
#   - /ical/node/{token}.ics      any subscribable node — project and identity
#                                 included since ADR-0073 (ADR-0039)
# The scoped feeds reuse the same share_token as their /share/ page, so a calendar and
# its share page are revoked together (see ADR-0023).

_ALARM_QUERY = Query(
    30,
    ge=0,
    le=10080,
    description="Reminder lead time in minutes before the due date; 0 disables reminders.",
)


def _render_calendar(calname: str, tasks: list, alarm: int) -> PlainTextResponse:
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


@ical_router.get("/ical/all/{token}.ics", tags=["ical"], response_class=PlainTextResponse)
def ical_feed_all(token: str, alarm: int = _ALARM_QUERY, db: Session = Depends(get_db)):
    """Personal feed: every due-dated task across all projects (global token)."""
    if not verify_global_ical_token(db, token):
        raise HTTPException(status_code=404, detail="Calendar not found")
    nodes = db.query(Node).filter(graph.task_type_filter(db), Node.due_date.isnot(None)).all()
    return _render_calendar("All tasks", [graph.task_view(n, db) for n in nodes], alarm)


# /ical/identity/{token}.ics was retired with ADR-0071: an identity's feed is
# /ical/node/{token}.ics below, which aggregates owns for exactly this type.


@ical_router.get("/ical/node/{token}.ics", tags=["ical"], response_class=PlainTextResponse)
def ical_feed_node(token: str, alarm: int = _ALARM_QUERY, db: Session = Depends(get_db)):
    """Generic feed for any ``is_subscribable`` node (ADR-0039).

    Identity aggregates its owns projects — this is the only feed that serves
    one since ADR-0071 — while every other subscribable container yields its own
    ``contains`` subtree. The token is the node's ``share_token`` (same as its
    share facade), so a feed and its share page are revoked together.
    """
    node = graph.find_subscribable_node_by_share_token(db, token)
    if node is None:
        raise HTTPException(status_code=404, detail="Calendar not found")
    if node.type == graph.NODE_IDENTITY:
        container_ids = graph.project_ids_for_identity(db, node.id)
    else:
        container_ids = [node.id]
    task_ids = {tid for cid in container_ids for tid in graph.contained_task_ids(db, cid)}
    nodes = (
        db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(task_ids), Node.due_date.isnot(None)).all()
        if task_ids
        else []
    )
    return _render_calendar(node.title, [graph.task_view(n, db) for n in nodes], alarm)
