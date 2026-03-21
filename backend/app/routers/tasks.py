import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Task
from app.schemas import TaskCreate, TaskUpdate, TaskOut
from app.services.activity import log_activity
from app.routers.deps import get_project_or_404 as _get_project_or_404

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(project_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    return db.query(Task).filter(Task.project_id == project_id).order_by(Task.created_at.asc()).all()


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(project_id: str, body: TaskCreate, db: Session = Depends(get_db)):
    project = _get_project_or_404(project_id, db)
    task = Task(project_id=project_id, **body.model_dump())
    db.add(task)
    db.flush()
    log_activity(
        db, "task.created",
        project_id=project_id, task_id=task.id,
        actor=body.assignee,
        detail=f'Task "{task.title}" created in {project.name}',
        meta={"title": task.title, "priority": task.priority},
    )
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(project_id: str, task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = body.model_dump(exclude_none=True)
    old_status = task.status
    old_assignee = task.assignee

    for field, value in changes.items():
        setattr(task, field, value)

    # Log status change
    if "status" in changes and changes["status"] != old_status:
        log_activity(
            db, "task.status_changed",
            project_id=project_id, task_id=task_id,
            actor=task.assignee,
            detail=f'Task "{task.title}" changed from {old_status} to {changes["status"]}',
            meta={"old_status": old_status, "new_status": changes["status"]},
        )

    # Log assignee change
    if "assignee" in changes and changes["assignee"] != old_assignee:
        log_activity(
            db, "task.assigned",
            project_id=project_id, task_id=task_id,
            actor=changes["assignee"],
            detail=f'Task "{task.title}" assigned to {changes["assignee"] or "unassigned"}',
            meta={"old_assignee": old_assignee, "new_assignee": changes["assignee"]},
        )

    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    log_activity(
        db, "task.deleted",
        project_id=project_id, task_id=task_id,
        actor=task.assignee,
        detail=f'Task "{task.title}" deleted',
        meta={"title": task.title},
    )
    db.delete(task)
    db.commit()


@router.post(
    "/{task_id}/regenerate-token",
    response_model=TaskOut,
    summary="Regenerate webhook callback token",
    description="Generates a new unique callback_token for a task. Old webhook URLs will stop working.",
)
def regenerate_token(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.callback_token = str(uuid.uuid4())
    log_activity(
        db, "task.token_regenerated",
        project_id=project_id, task_id=task_id,
        actor="system",
        detail=f'Webhook token regenerated for "{task.title}"',
        meta={"title": task.title},
    )
    db.commit()
    db.refresh(task)
    return task
