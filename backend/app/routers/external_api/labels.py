"""
External API v1 — Label CRUD endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Project
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404
from app.schemas import LabelCreate, LabelOut
from app.services import graph
from app.services.activity import log_activity
from app.services.ws_manager import ws_manager

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
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return graph.labels_in_project(db, project_id)


@sub_router.post(
    "/projects/{project_id}/labels",
    status_code=status.HTTP_201_CREATED,
    summary="Create a label",
    description="Creates a new label in a project. Labels can then be assigned to tasks. Requires `write` scope.",
    response_model=LabelOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_create_label(
    project_id: str,
    body: LabelCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    label = graph.create_label(db, project_id, **body.model_dump())
    db.commit()
    return label


@sub_router.delete(
    "/projects/{project_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a label",
    description="Permanently deletes a label and removes it from all tasks in the project. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Label not found"}},
)
def api_delete_label(
    project_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    label = graph.get_label(db, label_id, project_id=project_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    graph.delete_label(db, label_id)
    db.commit()


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
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)
    label = graph.get_label(db, label_id, project_id=project_id)
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label_id not in graph.label_ids_for_task(db, task_id):
        graph.set_label(db, task_id, label_id)
        log_activity(
            db,
            "task.label_added",
            project_id=project_id,
            task_id=task_id,
            actor=f"api:{api_key.name}",
            detail=f'Label "{label.name}" added to task "{task.title}" via API',
            meta={"label_id": label_id, "label_name": label.name, "api_key": api_key.name},
        )
        db.commit()
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task_id})
    return label


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a label from a task",
    description="Removes a label assignment from a task. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Label not assigned to task"}},
)
def api_remove_label_from_task(
    project_id: str,
    task_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    if not graph.unset_label(db, task_id, label_id):
        raise HTTPException(status_code=404, detail="Label not assigned to task")
    db.commit()
