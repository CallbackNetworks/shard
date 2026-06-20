from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Comment
from app.routers.deps import get_comment_or_404, get_project_or_404, get_task_or_404
from app.schemas import CommentCreate, CommentOut, CommentUpdate

router = APIRouter(prefix="/projects/{project_id}/tasks/{task_id}/comments", tags=["comments"])


def _validate_project_and_task(project_id: str, task_id: str, db: Session):
    get_project_or_404(project_id, db)
    get_task_or_404(task_id, db, project_id=project_id)


@router.get("", response_model=list[CommentOut])
def list_comments(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _validate_project_and_task(project_id, task_id, db)
    return db.query(Comment).filter(Comment.task_id == task_id).order_by(Comment.created_at.asc()).all()


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(project_id: str, task_id: str, body: CommentCreate, db: Session = Depends(get_db)):
    _validate_project_and_task(project_id, task_id, db)
    comment = Comment(task_id=task_id, project_id=project_id, **body.model_dump())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.patch("/{comment_id}", response_model=CommentOut)
def update_comment(project_id: str, task_id: str, comment_id: str, body: CommentUpdate, db: Session = Depends(get_db)):
    _validate_project_and_task(project_id, task_id, db)
    comment = get_comment_or_404(comment_id, db, task_id=task_id)
    comment.body = body.body
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(project_id: str, task_id: str, comment_id: str, db: Session = Depends(get_db)):
    _validate_project_and_task(project_id, task_id, db)
    comment = get_comment_or_404(comment_id, db, task_id=task_id)
    db.delete(comment)
    db.commit()
