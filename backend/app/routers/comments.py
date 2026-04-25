from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, Comment
from app.schemas import CommentCreate, CommentUpdate, CommentOut
from app.routers.deps import get_project_or_404

router = APIRouter(prefix="/projects/{project_id}/tasks/{task_id}/comments", tags=["comments"])


def _get_task_or_404(project_id: str, task_id: str, db: Session) -> Task:
    get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("", response_model=list[CommentOut])
def list_comments(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    return (
        db.query(Comment)
        .filter(Comment.task_id == task_id)
        .order_by(Comment.created_at.asc())
        .all()
    )


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(project_id: str, task_id: str, body: CommentCreate, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    comment = Comment(task_id=task_id, project_id=project_id, **body.model_dump())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(project_id: str, task_id: str, comment_id: str, body: CommentUpdate, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.body = body.body
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(project_id: str, task_id: str, comment_id: str, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
