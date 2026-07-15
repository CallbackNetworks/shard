"""
External API v1 — Task dependency endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Task, TaskDependency
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404

sub_router = APIRouter()


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}/dependencies",
    summary="Get task dependencies",
    description="""Returns the dependency graph for a task: which tasks block it (`blocked_by`) and which tasks it blocks (`blocking`).

Each entry includes `task_id`, `title`, and `status`, so agents can determine whether blockers are resolved without additional API calls. Requires `read` scope.""",
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_get_dependencies(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)

    blocked_by = []
    for dep in task.blocked_by_deps:
        blocker = db.query(Task).filter(Task.id == dep.depends_on_id).first()
        if blocker:
            blocked_by.append({"task_id": blocker.id, "title": blocker.title, "status": blocker.status})

    blocking = []
    for dep in task.blocking_deps:
        dependent = db.query(Task).filter(Task.id == dep.task_id).first()
        if dependent:
            blocking.append({"task_id": dependent.id, "title": dependent.title, "status": dependent.status})

    return {"task_id": task_id, "blocked_by": blocked_by, "blocking": blocking}


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}",
    status_code=status.HTTP_201_CREATED,
    summary="Add a blocker dependency",
    description="Marks `task_id` as blocked by `depends_on_id` — the blocker task must complete before this task can proceed. Idempotent. Requires `write` scope.",
    responses={
        **_auth_errors,
        400: {"description": "Self-dependency not allowed"},
        404: {"description": "Task not found"},
    },
)
def api_add_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    blocker = db.query(Task).filter(Task.id == depends_on_id, Task.project_id == project_id).first()
    if not blocker:
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if task_id == depends_on_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    existing = (
        db.query(TaskDependency)
        .filter(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_id == depends_on_id,
        )
        .first()
    )
    if existing:
        return {"task_id": task_id, "depends_on_id": depends_on_id}
    db.add(TaskDependency(task_id=task_id, depends_on_id=depends_on_id))  # edge mirrored by graph_sync listener
    db.commit()
    return {"task_id": task_id, "depends_on_id": depends_on_id}


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a blocker dependency",
    description="Removes the blocked-by relationship between two tasks. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Dependency not found"}},
)
def api_remove_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    dep = (
        db.query(TaskDependency)
        .filter(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_id == depends_on_id,
        )
        .first()
    )
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)  # edge removed by graph_sync listener
    db.commit()
