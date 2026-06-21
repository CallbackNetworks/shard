import csv
import io
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, TaskLabel
from app.routers.deps import get_project_or_404
from app.schemas import (
    BulkActionResult,
    BulkTaskUpdate,
    TaskImportItem,
    TaskImportRequest,
    TaskImportResult,
)
from app.services.activity import log_activity
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

_ICAL_STATUS_MAP = {
    "done": "COMPLETED",
    "in_progress": "IN-PROCESS",
    "todo": "NEEDS-ACTION",
    "failed": "CANCELLED",
}


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
            exists = db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == label_id).first()
            if not exists:
                db.add(TaskLabel(task_id=task.id, label_id=label_id))

        # Remove labels
        for label_id in body.remove_label_ids:
            db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == label_id).delete()

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
# 4. iCal Feed
# ---------------------------------------------------------------------------


@router.get(
    "/ical/{project_id}.ics",
    tags=["ical"],
    response_class=PlainTextResponse,
)
def ical_feed(
    project_id: str,
    db: Session = Depends(get_db),
):
    get_project_or_404(project_id, db)

    tasks = db.query(Task).filter(Task.project_id == project_id, Task.due_date.isnot(None)).all()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Shard//EN",
    ]

    for t in tasks:
        dt_str = t.due_date.strftime("%Y%m%d")
        ical_status = _ICAL_STATUS_MAP.get(t.status, "NEEDS-ACTION")
        description = (t.description or "").replace("\n", "\\n")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{t.id}@shard",
                f"DTSTART;VALUE=DATE:{dt_str}",
                f"SUMMARY:{t.title}",
                f"DESCRIPTION:{description}",
                f"STATUS:{ical_status}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")

    return PlainTextResponse(
        content="\r\n".join(lines),
        media_type="text/calendar",
    )
