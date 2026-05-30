"""
External API v1 — Search endpoint.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Project, Task
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.routers.external_api.helpers import _enrich_task_for_search

sub_router = APIRouter()


@sub_router.get(
    "/search",
    summary="Search tasks and projects",
    description="""Full-text search across task titles/descriptions and project names/descriptions.

Useful for AI agents to locate relevant tasks without paginating all projects. Returns enriched tasks (with labels, subtask counts, dependency IDs) and matching projects.

If the API key is scoped to a single project, search is automatically restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_search(
    q: str = Query(..., min_length=1, description="Search query (case-insensitive substring match)"),
    project_id: str | None = Query(None, description="Restrict search to a specific project"),
    limit: int = Query(50, ge=1, le=200, description="Max number of tasks to return"),
    offset: int = Query(0, ge=0, description="Offset for task pagination"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")

    # Project-scoped keys override the project_id filter
    if api_key.project_id:
        project_id = api_key.project_id

    pattern = f"%{q}%"

    task_query = db.query(Task).filter((Task.title.ilike(pattern)) | (Task.description.ilike(pattern)))
    if project_id:
        task_query = task_query.filter(Task.project_id == project_id)
    tasks = task_query.order_by(Task.updated_at.desc()).offset(offset).limit(limit).all()

    projects = []
    if not project_id:
        proj_query = db.query(Project).filter((Project.name.ilike(pattern)) | (Project.description.ilike(pattern)))
        for p in proj_query.limit(20).all():
            total = len(p.tasks)
            done = sum(1 for t in p.tasks if t.status == "done")
            projects.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "status": p.status,
                    "total_tasks": total,
                    "done_tasks": done,
                    "progress": round(done / total * 100, 1) if total > 0 else 0.0,
                    "created_at": p.created_at.isoformat(),
                    "updated_at": p.updated_at.isoformat(),
                }
            )

    return {
        "query": q,
        "tasks": [_enrich_task_for_search(t) for t in tasks],
        "projects": projects,
    }
