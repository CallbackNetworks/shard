from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Task
from app.schemas import TaskOut, LabelOut

router = APIRouter(prefix="/search", tags=["search"])


def _enrich_task(task) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by = [d.depends_on_id for d in task.blocked_by_deps]
    out.blocking = [d.task_id for d in task.blocking_deps]
    return out.model_dump()


@router.get("")
def search(
    q: str = Query(..., min_length=1, description="Search query"),
    project_id: str | None = Query(None, description="Limit to a specific project"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Full-text search across tasks and projects using case-insensitive LIKE matching."""
    pattern = f"%{q}%"

    # Search tasks
    task_query = db.query(Task).filter(
        (Task.title.ilike(pattern)) | (Task.description.ilike(pattern))
    )
    if project_id:
        task_query = task_query.filter(Task.project_id == project_id)
    tasks = task_query.order_by(Task.updated_at.desc()).offset(offset).limit(limit).all()

    # Search projects (only if no project_id filter)
    projects = []
    if not project_id:
        proj_query = db.query(Project).filter(
            (Project.name.ilike(pattern)) | (Project.description.ilike(pattern))
        )
        for p in proj_query.limit(20).all():
            total = len(p.tasks)
            done = sum(1 for t in p.tasks if t.status == "done")
            projects.append({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "status": p.status,
                "total_tasks": total,
                "done_tasks": done,
                "progress": round(done / total * 100, 1) if total > 0 else 0.0,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
            })

    return {
        "query": q,
        "tasks": [_enrich_task(t) for t in tasks],
        "projects": projects,
    }
