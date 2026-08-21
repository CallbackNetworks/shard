"""
External API v1 — Task CRUD and bulk operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Node
from app.routers.deps import get_parent_task_or_error
from app.routers.external_api.auth import (
    _auth_errors,
    _build_actor,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.schemas import TaskCreate, TaskOut
from app.services import graph
from app.services.enrichment import enrich_task
from app.services.task_mutations import apply_task_update, finalize_task_create
from app.services.ws_manager import ws_manager

sub_router = APIRouter()


@sub_router.get(
    "/projects/{project_id}/tasks",
    summary="List tasks in a project",
    description="Returns tasks for a project, optionally filtered by status and/or priority. Requires `read` scope.",
    response_model=list[TaskOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_list_tasks(
    project_id: str,
    status_filter: str | None = Query(None, description="Filter by status: todo, in_progress, done, or failed"),
    priority: str | None = Query(None, description="Filter by priority: low, medium, or high"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    query = db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(graph.contained_task_ids(db, project_id)))
    if status_filter:
        query = query.filter(Node.status == status_filter)
    if priority:
        query = query.filter(Node.priority == priority)
    return [enrich_task(graph.task_view(n, db), db) for n in query.order_by(Node.created_at.asc()).all()]


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Get a single task",
    description="Returns a single task by ID within a project. Requires `read` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_get_task(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return enrich_task(task, db)


# Single-task create/update/delete retired (ADR-0042): use the graph-native
# write surface — POST/PATCH/DELETE /api/v1/nodes. Reads and the batch facades
# below stay (bulk is a batch operation, not a second single-entity write path).


# ── Bulk operations ───────────────────────────────────────────────


@sub_router.post(
    "/projects/{project_id}/tasks/bulk",
    summary="Bulk create tasks",
    description="Creates multiple tasks in one request. Returns the list of created tasks. Requires `write` scope.",
    response_model=list[TaskOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
async def api_bulk_create_tasks(
    project_id: str,
    tasks: list[TaskCreate],
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Validate the whole batch up front so a bad item cannot leave a
    # partially-created batch behind (single commit below).
    for body in tasks:
        if body.parent_id is not None:
            get_parent_task_or_error(db, project_id, body.parent_id)
    actor = _build_actor(api_key, None)
    created = []
    for body in tasks:
        task = graph.create_task(db, project_id=project_id, **body.model_dump())
        await finalize_task_create(
            db,
            task.id,
            actor=actor,
            source="api",
            project_id=project_id,
            activity_meta={"api_key": api_key.name},
            commit=False,
            broadcast=False,
        )
        created.append(task.id)
    db.commit()
    await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": created})
    return [enrich_task(graph.get_task(db, tid), db) for tid in created]


@sub_router.post(
    "/projects/{project_id}/tasks/bulk-update",
    summary="Bulk update tasks",
    description="Updates multiple tasks in one request. Each item needs an `id` field and the fields to update. Status changes trigger notifications. Requires `write` scope.",
    responses={**_auth_errors},
)
async def api_bulk_update_tasks(
    project_id: str,
    updates: list[dict],
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    """Bulk update tasks. Each item needs 'id' and fields to update."""
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    _ALLOWED_FIELDS = {
        "title",
        "description",
        "status",
        "priority",
        "assignee",
        "due_date",
        "start_date",
        "time_estimate",
        "time_spent",
        "is_pinned",
        "parent_id",
        "position",
        "progress_pct",
    }
    actor = _build_actor(api_key, None)
    results = []
    for update in updates:
        task_id = update.pop("id", None)
        if not task_id:
            continue
        task = graph.get_task(db, task_id)
        if not task or task_id not in graph.contained_task_ids(db, project_id):
            continue
        changes: dict = {}
        for field, value in update.items():
            if field not in _ALLOWED_FIELDS:
                continue
            if field == "parent_id":
                # Re-parenting is a graph move, not a column write (ADR-0032).
                if value is not None:
                    get_parent_task_or_error(db, project_id, value, child_id=task_id)
                    graph.set_parent_task(db, task_id, value)
                continue
            if field == "title":
                if not isinstance(value, str) or not value.strip():
                    raise HTTPException(status_code=422, detail="Title must not be blank")
                if len(value.strip()) > 500:
                    raise HTTPException(status_code=422, detail="Title must be 500 characters or fewer")
                value = value.strip()
            changes[field] = value
        # Per-task commit keeps a rule failure from rolling back earlier
        # items; the aggregate broadcast below replaces per-task events.
        await apply_task_update(
            db,
            task_id,
            changes,
            actor=actor,
            source="api",
            project_id=project_id,
            activity_meta={"api_key": api_key.name},
            broadcast=False,
        )
        results.append(task_id)

    await ws_manager.broadcast("task.bulk_updated", {"project_id": project_id, "task_ids": results})
    return [enrich_task(graph.get_task(db, tid), db) for tid in results]
