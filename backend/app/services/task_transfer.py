"""Bulk export and import of a project's tasks, for both doors (ADR-0086).

``/api/v1`` could create tasks one at a time and in bulk, but had no round trip: no way to
take a project's work out and no way to put a tree of it back. Migrating between projects,
seeding from a plan, or handing a snapshot to something else were all browser-only.

Import goes through ``finalize_task_create`` per task with ``commit=False``, so the whole
tree lands as one transaction and one ``task.imported`` broadcast — not N of each.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Node
from app.schemas import TaskImportItem
from app.services import graph
from app.services.activity import log_activity
from app.services.errors import NotFound
from app.services.task_mutations import finalize_task_create

EXPORT_FIELDS = [
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


def _project_or_404(db: Session, project_id: str):
    project = graph.get_project(db, project_id)
    if project is None:
        raise NotFound("Project not found")
    return project


def export_rows(db: Session, project_id: str) -> list[dict]:
    """Every task in the project as flat rows, in board order."""
    _project_or_404(db, project_id)
    task_ids = graph.contained_task_ids(db, project_id)
    task_nodes = (
        db.query(Node)
        .filter(Node.type == graph.NODE_TASK, Node.id.in_(task_ids))
        .order_by(Node.position.asc(), Node.created_at.asc())
        .all()
        if task_ids
        else []
    )
    return [
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
        for t in (graph.task_view(n, db) for n in task_nodes)
    ]


async def _create_recursive(
    db: Session,
    project_id: str,
    item: TaskImportItem,
    parent_id: str | None,
    created_ids: list[str],
) -> None:
    task = graph.create_task(
        db,
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
    # The caller owns the commit and emits one aggregate task.imported event, so the whole
    # tree lands as a single transaction and a single broadcast.
    await finalize_task_create(
        db,
        task.id,
        source="import",
        project_id=project_id,
        activity_meta={"source": "json"},
        commit=False,
        broadcast=False,
    )
    created_ids.append(task.id)

    for sub in item.subtasks:
        await _create_recursive(db, project_id, sub, task.id, created_ids)


async def import_tasks(db: Session, project_id: str, items: list[TaskImportItem], *, actor: str | None) -> list[str]:
    """Create a tree of tasks under a project. Returns the created ids, root-first."""
    project = _project_or_404(db, project_id)

    created_ids: list[str] = []
    for item in items:
        await _create_recursive(db, project_id, item, None, created_ids)

    log_activity(
        db,
        "task.imported",
        project_id=project_id,
        task_id=None,
        actor=actor,
        detail=f"Imported {len(created_ids)} task(s) into {project.name}",
        meta={"task_ids": created_ids},
    )
    db.commit()
    return created_ids
