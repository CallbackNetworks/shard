"""
External API v1 — Label CRUD endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404
from app.schemas import LabelOut
from app.services import graph
from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed

sub_router = APIRouter()


@sub_router.get(
    "/projects/{project_id}/labels",
    summary="List labels in a project",
    description="Returns all labels defined in a project. Requires `read` scope.",
    response_model=list[LabelOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_list_labels(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return graph.labels_in_project(db, project_id)


# Label create/delete retired (ADR-0042): a label is a node — create it via
# POST /api/v1/nodes (type "label") + a `contains` edge to the project, and delete
# it via DELETE /api/v1/nodes/{id}. Listing and task↔label assignment stay here.


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_201_CREATED,
    summary="Assign a label to a task",
    description="Assigns an existing project label to a task. Idempotent — safe to call even if already assigned. Requires `write` scope.",
    response_model=LabelOut,
    responses={**_auth_errors, 404: {"description": "Task or label not found"}},
)
async def api_add_label_to_task(
    project_id: str,
    task_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    label = graph.get_label(db, label_id, project_id=project_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label_id not in graph.label_ids_for_task(db, task_id):
        graph.set_label(db, task_id, label_id)
        await dispatch_edge_added(db, task_id, label_id, graph.REL_LABELED, actor=f"api:{api_key.name}")
    return label


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a label from a task",
    description="Removes a label assignment from a task. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Label not assigned to task"}},
)
async def api_remove_label_from_task(
    project_id: str,
    task_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    if not graph.unset_label(db, task_id, label_id):
        raise HTTPException(status_code=404, detail="Label not assigned to task")
    await dispatch_edge_removed(db, task_id, label_id, graph.REL_LABELED, actor=f"api:{api_key.name}")
