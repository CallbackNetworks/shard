import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Edge, Node, Project
from app.services import graph
from app.services.enrichment import enrich_task_as_dict
from app.services.search_backend import get_search_backend

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
def search(
    request: Request,
    q: str = Query(..., min_length=1, description="Search query"),
    project_id: str | None = Query(None, description="Limit to a specific project"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Full-text search across tasks and projects. Uses FTS when available, falls back to LIKE."""
    # Resolve the backend from the session's actual dialect, not the global
    # DATABASE_URL, so an overridden session (e.g. in tests) picks the right FTS.
    search_backend = get_search_backend(db.get_bind().dialect.name)
    task_ids, used_fts = search_backend.search_tasks(db, q, project_id, limit, offset)
    pattern = f"%{q}%"

    tasks = []
    if used_fts and task_ids:
        # Preserve FTS rank order (task_views_for_ids keeps input order).
        allowed = set(graph.contained_task_ids(db, project_id)) if project_id else None
        ordered = [tid for tid in task_ids if allowed is None or tid in allowed]
        tasks = graph.task_views_for_ids(db, ordered)

    if not used_fts:
        # title/description live on the task node (description in JSON data); scan in
        # Python for dialect-safe LIKE fallback (ADR-0033, node-only tasks).
        ql = q.lower()
        scope = set(graph.contained_task_ids(db, project_id)) if project_id else None
        nodes = db.query(Node).filter(Node.type == graph.NODE_TASK).order_by(Node.updated_at.desc()).all()
        matched = [
            n
            for n in nodes
            if (ql in (n.title or "").lower() or ql in ((n.data or {}).get("description") or "").lower())
            and (scope is None or n.id in scope)
        ][offset : offset + limit]
        tasks = [graph.task_view(n, db) for n in matched]

    # Search projects (only if no project_id filter)
    projects = []
    if not project_id:
        # Task membership is via graph contains edges (ADR-0032, no primary).
        total_sq = (
            select(func.count(Edge.target_id))
            .where(Edge.source_id == Project.id, Edge.rel_type == graph.REL_CONTAINS)
            .correlate(Project)
            .scalar_subquery()
            .label("total_tasks")
        )
        done_sq = (
            select(func.count(Node.id))
            .select_from(Edge)
            .join(Node, Node.id == Edge.target_id)
            .where(
                Edge.source_id == Project.id,
                Edge.rel_type == graph.REL_CONTAINS,
                Node.type == graph.NODE_TASK,
                Node.status == "done",
            )
            .correlate(Project)
            .scalar_subquery()
            .label("done_tasks")
        )
        proj_query = db.query(Project, total_sq, done_sq).filter(
            (Project.name.ilike(pattern)) | (Project.description.ilike(pattern))
        )
        for p, total, done in proj_query.limit(20).all():
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

    task_ids = [t.id for t in tasks]
    dep_maps = graph.dependency_maps(db, task_ids)
    labels_by_task = graph.labels_map(db, task_ids)
    return {
        "query": q,
        "tasks": [enrich_task_as_dict(t, db, dep_maps, labels_by_task) for t in tasks],
        "projects": projects,
    }
