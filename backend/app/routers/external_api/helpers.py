"""
Shared helpers for External API v1.

Provides project/task enrichment and lookup utilities.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Project, Task
from app.schemas import LabelOut, TaskOut


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
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _enrich_task_for_search(task: Task) -> dict:
    """Attach labels, counts, and dependency IDs to a TaskOut dict."""
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by = [d.depends_on_id for d in task.blocked_by_deps]
    out.blocking = [d.task_id for d in task.blocking_deps]
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()
