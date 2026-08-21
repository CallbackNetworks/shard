"""
External API v1 — Search endpoint.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Node
from app.routers.external_api.auth import _auth_errors, _get_api_key, _project_ids_in_scope, _require_scope
from app.routers.external_api.helpers import _enrich_task_for_search
from app.services import graph

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

    # Container-scoped keys override the caller's project_id filter with their own scope.
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is not None:
        project_id = scoped_project_ids[0] if len(scoped_project_ids) == 1 else None
        scope = set()
        for pid in scoped_project_ids:
            scope |= set(graph.contained_task_ids(db, pid))
    else:
        scope = set(graph.contained_task_ids(db, project_id)) if project_id else None

    # title/description live on the task node (description in JSON data); scan in
    # Python for dialect-safe substring matching (ADR-0033, node-only tasks).
    ql = q.lower()
    matched = [
        n
        for n in db.query(Node).filter(graph.task_type_filter(db)).order_by(Node.updated_at.desc()).all()
        if (ql in (n.title or "").lower() or ql in ((n.data or {}).get("description") or "").lower())
        and (scope is None or n.id in scope)
    ][offset : offset + limit]
    tasks = [graph.task_view(n, db) for n in matched]

    projects = []
    if scoped_project_ids is None or len(scoped_project_ids) > 1:
        candidate_projects = graph.search_projects(db, q, limit=20)
        if scoped_project_ids is not None:
            allowed = set(scoped_project_ids)
            candidate_projects = [p for p in candidate_projects if p.id in allowed]
        for p in candidate_projects:
            p_tasks = graph.subtree_task_views(db, p.id, top_level_only=True)
            total = len(p_tasks)
            done = sum(1 for t in p_tasks if t.status == "done")
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
        "tasks": [_enrich_task_for_search(t, db) for t in tasks],
        "projects": projects,
    }
