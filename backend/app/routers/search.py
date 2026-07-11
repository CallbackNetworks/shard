import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Task
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
        task_query = db.query(Task).filter(Task.id.in_(task_ids))
        if project_id:
            task_query = task_query.filter(Task.project_id == project_id)
        tasks = task_query.all()
        # Preserve FTS rank order
        id_order = {tid: i for i, tid in enumerate(task_ids)}
        tasks.sort(key=lambda t: id_order.get(t.id, 0))

    if not used_fts:
        task_query = db.query(Task).filter((Task.title.ilike(pattern)) | (Task.description.ilike(pattern)))
        if project_id:
            task_query = task_query.filter(Task.project_id == project_id)
        tasks = task_query.order_by(Task.updated_at.desc()).offset(offset).limit(limit).all()

    # Search projects (only if no project_id filter)
    projects = []
    if not project_id:
        total_sq = (
            select(func.count(Task.id))
            .where(Task.project_id == Project.id)
            .correlate(Project)
            .scalar_subquery()
            .label("total_tasks")
        )
        done_sq = (
            select(func.count(Task.id))
            .where(Task.project_id == Project.id, Task.status == "done")
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

    return {
        "query": q,
        "tasks": [enrich_task_as_dict(t) for t in tasks],
        "projects": projects,
    }
