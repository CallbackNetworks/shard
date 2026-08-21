"""
External API v1 — Project CRUD endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _projects_in_scope,
    _require_scope,
)
from app.routers.external_api.helpers import _enrich_project
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
    projects = _projects_in_scope(db, api_key)
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
    _check_project_access(db, api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    result = _enrich_project(project, db)
    # Tasks are node-only (ADR-0033): serialize each task view through enrichment.
    result["tasks"] = [enrich_task_as_dict(t, db) for t in graph.tasks_in_project(db, project.id)]
    return result


# Project create/update/delete retired (ADR-0042): use the graph-native write
# surface — POST/PATCH/DELETE /api/v1/nodes with type "project". Reads stay here.
