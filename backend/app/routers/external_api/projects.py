"""
External API v1 — Project CRUD endpoints.
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
from app.routers.external_api.helpers import _enrich_project
from app.schemas import ProjectCreate, ProjectUpdate
from app.services import graph
from app.services.enrichment import enrich_task_as_dict

sub_router = APIRouter()


@sub_router.get(
    "/projects",
    summary="List all projects",
    description="Returns all projects accessible to this API key. If the key is scoped to a single project, only that project is returned. Each project includes progress stats (done/total tasks). Requires `read` scope.",
    responses=_auth_errors,
)
def api_list_projects(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    query = db.query(Project)
    if api_key.project_id:
        query = query.filter(Project.id == api_key.project_id)
    projects = query.order_by(Project.created_at.desc()).all()
    return [_enrich_project(p, db) for p in projects]


@sub_router.get(
    "/projects/{project_id}",
    summary="Get a project with all its tasks",
    description="Returns a single project with full task list. Requires `read` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_get_project(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    result = _enrich_project(project, db)
    # Tasks are node-only (ADR-0033): serialize each task view through enrichment.
    result["tasks"] = [enrich_task_as_dict(t, db) for t in graph.tasks_in_project(db, project.id)]
    return result


@sub_router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
    description="Creates a new project. Requires `write` scope.",
    responses=_auth_errors,
)
def api_create_project(
    body: ProjectCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    project = Project(**body.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return _enrich_project(project, db)


@sub_router.patch(
    "/projects/{project_id}",
    summary="Update a project",
    description="Partially updates a project's name, description, or status. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_update_project(
    project_id: str,
    body: ProjectUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return _enrich_project(project, db)


@sub_router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
    description="Permanently deletes a project and all its tasks. Requires `admin` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    graph.delete_project_and_tasks(db, project)
    db.commit()
