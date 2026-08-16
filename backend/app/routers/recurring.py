"""Task recurrence for the SPA.

Thin over ``services/recurrence_admin``, which ``/api/v1`` calls too (ADR-0086).
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import RecurrenceRuleCreate, RecurrenceRuleOut, RecurrenceRuleUpdate
from app.services import recurrence_admin

router = APIRouter(
    prefix="/projects/{project_id}/tasks/{task_id}/recurrence",
    tags=["recurrence"],
)


@router.get("", response_model=RecurrenceRuleOut)
def get_recurrence(project_id: str, task_id: str, db: Session = Depends(get_db)):
    return recurrence_admin.get(db, project_id, task_id)


@router.post("", response_model=RecurrenceRuleOut, status_code=status.HTTP_201_CREATED)
def set_recurrence(project_id: str, task_id: str, body: RecurrenceRuleCreate, db: Session = Depends(get_db)):
    return recurrence_admin.create(db, project_id, task_id, body)


@router.patch("", response_model=RecurrenceRuleOut)
def update_recurrence(project_id: str, task_id: str, body: RecurrenceRuleUpdate, db: Session = Depends(get_db)):
    return recurrence_admin.update(db, project_id, task_id, body)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurrence(project_id: str, task_id: str, db: Session = Depends(get_db)):
    recurrence_admin.delete(db, project_id, task_id)
