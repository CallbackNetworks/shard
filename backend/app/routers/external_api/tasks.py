"""
External API v1 — Task CRUD and bulk operations.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
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
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.services import graph
from app.services.activity import log_activity
from app.services.enrichment import enrich_task
from app.services.notifier import fire_notifications

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
    _check_project_access(api_key, project_id)
    query = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.id.in_(graph.contained_task_ids(db, project_id)))
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
    _check_project_access(api_key, project_id)
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return enrich_task(task, db)


@sub_router.post(
    "/projects/{project_id}/tasks",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new task",
    description="Creates a task in a project. The task gets a unique `callback_token` for CI/CD webhook integration. Requires `write` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_create_task(
    project_id: str,
    body: TaskCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.parent_id is not None:
        get_parent_task_or_error(db, project_id, body.parent_id)
    task = graph.create_task(db, project_id=project_id, **body.model_dump())
    actor = _build_actor(api_key, x_agent_id)
    log_activity(
        db,
        "task.created",
        project_id=project_id,
        task_id=task.id,
        actor=actor,
        detail=f'Task "{task.title}" created via API',
        meta={"title": task.title, "priority": task.priority, "api_key": api_key.name, "agent_id": x_agent_id},
    )
    db.commit()
    return enrich_task(graph.get_task(db, task.id), db)


@sub_router.patch(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Update a task",
    description="Partially updates a task. When status changes, outbound notifications are fired to matching integrations. Requires `write` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
async def api_update_task(
    project_id: str,
    task_id: str,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Task not found")
    old_status = task.status
    changes = body.model_dump(exclude_none=True)
    # Re-parenting is a graph move, not a column write (ADR-0032).
    new_parent_id = changes.pop("parent_id", None)
    if new_parent_id is not None:
        get_parent_task_or_error(db, project_id, new_parent_id, child_id=task_id)
        graph.set_parent_task(db, task_id, new_parent_id)
    if changes:
        task = graph.update_task(db, task_id, **changes)

    actor = _build_actor(api_key, x_agent_id)
    if body.status and body.status != old_status:
        log_activity(
            db,
            "task.status_changed",
            project_id=project_id,
            task_id=task_id,
            actor=actor,
            detail=f'Task "{task.title}" changed from {old_status} to {body.status} via API',
            meta={"old_status": old_status, "new_status": body.status, "api_key": api_key.name, "agent_id": x_agent_id},
        )

    db.commit()
    task = graph.get_task(db, task_id)

    # Fire notifications on status change
    if body.status and body.status != old_status:
        event = f"task.{body.status}"
        await fire_notifications(db, task, event)
        if body.status == "done":
            project = graph.project_of_task(db, task.id)
            if project is not None and all(t.status == "done" for t in graph.tasks_in_project(db, project.id)):
                await fire_notifications(db, task, "project.complete")

    return enrich_task(task, db)


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a task",
    description="Permanently deletes a task. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_delete_task(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Task not found")
    graph.delete_task_tree(db, task.id)
    db.commit()


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
    _check_project_access(api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    created = []
    for body in tasks:
        if body.parent_id is not None:
            get_parent_task_or_error(db, project_id, body.parent_id)
        task = graph.create_task(db, project_id=project_id, **body.model_dump())
        created.append(task.id)
    db.commit()
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
    _check_project_access(api_key, project_id)
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
    results = []
    for update in updates:
        task_id = update.pop("id", None)
        if not task_id:
            continue
        task = graph.get_task(db, task_id)
        if not task or task_id not in graph.contained_task_ids(db, project_id):
            continue
        old_status = task.status
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
        if changes:
            task = graph.update_task(db, task_id, **changes)
        results.append(task_id)

        if "status" in update and update["status"] != old_status:
            event = f"task.{update['status']}"
            await fire_notifications(db, task, event)

    db.commit()
    return [enrich_task(graph.get_task(db, tid), db) for tid in results]
