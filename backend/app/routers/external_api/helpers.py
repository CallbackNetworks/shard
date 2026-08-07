"""
Shared helpers for External API v1.

Provides project enrichment and lookup utilities.
"""

from sqlalchemy.orm import Session

from app.routers.deps import get_task_or_404 as _deps_get_task_or_404
from app.services import graph
from app.services.enrichment import enrich_task_as_dict

_PROJECT_FIELDS = (
    "id",
    "name",
    "description",
    "status",
    "share_token",
    "share_expires_at",
    "allow_guest_notes",
    "agent_instructions",
    "repo_url",
    "wip_limits",
    "created_at",
    "updated_at",
)


def _enrich_project(project: "graph.ProjectView", db: Session) -> dict:
    # Subtree scope, top-level tasks (ADR-0065) so v1's counts match the app's.
    tasks = graph.subtree_task_views(db, project.id, top_level_only=True)
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    return {
        **{name: getattr(project, name) for name in _PROJECT_FIELDS},
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "total_tasks": total,
        "done_tasks": done,
        "tasks": [],
        "labels": [],
        "cycles": [],
    }


def _get_task_or_404(project_id: str, task_id: str, db: Session) -> graph.TaskView:
    """Shared helper: validate task exists within the given project."""
    return _deps_get_task_or_404(task_id, db, project_id=project_id)


def _enrich_task_for_search(task: "graph.TaskView", db: Session) -> dict:
    """Attach labels, counts, and dependency IDs to a TaskOut dict."""
    return enrich_task_as_dict(task, db)
