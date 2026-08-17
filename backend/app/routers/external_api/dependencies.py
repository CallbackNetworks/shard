"""
External API v1 — Task dependency endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Node
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404
from app.services import graph
from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed

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
    _get_task_or_404(project_id, task_id, db)

    def _summaries(ids):
        rows = db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(ids)).all() if ids else []
        return [{"task_id": t.id, "title": t.title, "status": t.status} for t in rows]

    blocked_by = _summaries(graph.prerequisite_ids(db, task_id))
    blocking = _summaries(graph.dependent_ids(db, task_id))

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
async def api_add_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)
    blocker = graph.get_task(db, depends_on_id)
    if not blocker or depends_on_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if task_id == depends_on_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    graph.ensure_node(db, task_id, graph.NODE_TASK, title=task.title)
    graph.ensure_node(db, depends_on_id, graph.NODE_TASK, title=blocker.title)
    graph.add_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON)
    await dispatch_edge_added(db, task_id, depends_on_id, graph.REL_DEPENDS_ON, actor=f"api:{api_key.name}")
    return {"task_id": task_id, "depends_on_id": depends_on_id}


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a blocker dependency",
    description="Removes the blocked-by relationship between two tasks. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Dependency not found"}},
)
async def api_remove_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    if not graph.remove_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON):
        raise HTTPException(status_code=404, detail="Dependency not found")
    await dispatch_edge_removed(db, task_id, depends_on_id, graph.REL_DEPENDS_ON, actor=f"api:{api_key.name}")
