"""
Shared helpers for External API v1.

Provides project enrichment and lookup utilities.
"""

from sqlalchemy.orm import Session

from app.models import Project, Task
from app.routers.deps import get_task_or_404 as _deps_get_task_or_404
from app.services.enrichment import enrich_task_as_dict


def _enrich_project(project: Project) -> dict:
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    return {
        **{c.name: getattr(project, c.name) for c in project.__table__.columns},
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "total_tasks": total,
        "done_tasks": done,
        "tasks": [],
        "labels": [],
        "cycles": [],
    }


def _get_task_or_404(project_id: str, task_id: str, db: Session) -> Task:
    """Shared helper: validate task exists within the given project."""
    return _deps_get_task_or_404(task_id, db, project_id=project_id)


def _enrich_task_for_search(task: Task) -> dict:
    """Attach labels, counts, and dependency IDs to a TaskOut dict."""
    return enrich_task_as_dict(task)
