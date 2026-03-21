from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Label, Task, TaskLabel
from app.schemas import LabelCreate, LabelOut
from app.routers.deps import get_project_or_404 as _get_project_or_404

router = APIRouter(prefix="/projects/{project_id}/labels", tags=["labels"])


@router.get("", response_model=list[LabelOut])
def list_labels(project_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    return db.query(Label).filter(Label.project_id == project_id).order_by(Label.created_at.asc()).all()


@router.post("", response_model=LabelOut, status_code=status.HTTP_201_CREATED)
def create_label(project_id: str, body: LabelCreate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    label = Label(project_id=project_id, **body.model_dump())
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label(project_id: str, label_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    label = db.query(Label).filter(Label.id == label_id, Label.project_id == project_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    db.delete(label)
    db.commit()


# Task-label endpoints (nested under tasks)
task_label_router = APIRouter(
    prefix="/projects/{project_id}/tasks/{task_id}/labels",
    tags=["labels"],
)


@task_label_router.post("/{label_id}", response_model=LabelOut, status_code=status.HTTP_201_CREATED)
def add_label_to_task(project_id: str, task_id: str, label_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    label = db.query(Label).filter(Label.id == label_id, Label.project_id == project_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    existing = db.query(TaskLabel).filter(
        TaskLabel.task_id == task_id, TaskLabel.label_id == label_id
    ).first()
    if not existing:
        tl = TaskLabel(task_id=task_id, label_id=label_id)
        db.add(tl)
        db.commit()
    return label


@task_label_router.delete("/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_label_from_task(project_id: str, task_id: str, label_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    tl = db.query(TaskLabel).filter(
        TaskLabel.task_id == task_id, TaskLabel.label_id == label_id
    ).first()
    if not tl:
        raise HTTPException(status_code=404, detail="Label not assigned to task")
    db.delete(tl)
    db.commit()
