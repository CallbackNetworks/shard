from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Task, RecurrenceRule
from app.schemas import RecurrenceRuleCreate, RecurrenceRuleUpdate, RecurrenceRuleOut

router = APIRouter(
    prefix="/projects/{project_id}/tasks/{task_id}/recurrence",
    tags=["recurrence"],
)


def _get_task_or_404(project_id: str, task_id: str, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("", response_model=RecurrenceRuleOut)
def get_recurrence(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="No recurrence rule for this task")
    return rule


@router.post("", response_model=RecurrenceRuleOut, status_code=status.HTTP_201_CREATED)
def set_recurrence(project_id: str, task_id: str, body: RecurrenceRuleCreate, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    existing = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Recurrence rule already exists — use PATCH to update")
    rule = RecurrenceRule(
        template_task_id=task_id,
        frequency=body.frequency,
        interval_value=body.interval_value,
        day_of_week=body.day_of_week,
        day_of_month=body.day_of_month,
        next_run_at=body.next_run_at,
        end_date=body.end_date,
        active=body.active,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.patch("", response_model=RecurrenceRuleOut)
def update_recurrence(project_id: str, task_id: str, body: RecurrenceRuleUpdate, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="No recurrence rule for this task")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, val)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurrence(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_task_or_404(project_id, task_id, db)
    rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="No recurrence rule for this task")
    db.delete(rule)
    db.commit()
