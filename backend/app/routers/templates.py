from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TaskTemplate
from app.schemas import TaskTemplateCreate, TaskTemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TaskTemplateOut])
def list_templates(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(TaskTemplate)
    if project_id:
        q = q.filter((TaskTemplate.project_id == project_id) | (TaskTemplate.project_id.is_(None)))
    return q.order_by(TaskTemplate.created_at.desc()).all()


@router.post("", response_model=TaskTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(body: TaskTemplateCreate, db: Session = Depends(get_db)):
    tpl = TaskTemplate(**body.model_dump())
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: str, db: Session = Depends(get_db)):
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tpl)
    db.commit()
