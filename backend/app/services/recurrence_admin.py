"""A task's recurrence rule, for both doors (ADR-0086).

``enrich_task`` puts ``recurrence`` on every ``TaskOut``, so every agent reading a task
through ``/api/v1`` has been shown the field since the day it was added — and had no way to
set, change or clear it. A field you can read and never write is not a missing feature, it
is a half-open door: the API describes a capability it does not offer.
"""

from sqlalchemy.orm import Session

from app.models import RecurrenceRule
from app.schemas import RecurrenceRuleCreate, RecurrenceRuleUpdate
from app.services import graph
from app.services.errors import NotFound, ServiceError


def load_task(db: Session, project_id: str, task_id: str) -> graph.TaskView:
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise NotFound("Task not found")
    return task


def _rule(db: Session, task_id: str) -> RecurrenceRule | None:
    return db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).first()


def get(db: Session, project_id: str, task_id: str) -> RecurrenceRule:
    load_task(db, project_id, task_id)
    rule = _rule(db, task_id)
    if not rule:
        raise NotFound("No recurrence rule for this task")
    return rule


def create(db: Session, project_id: str, task_id: str, body: RecurrenceRuleCreate) -> RecurrenceRule:
    load_task(db, project_id, task_id)
    if _rule(db, task_id):
        raise ServiceError(409, "Recurrence rule already exists — use PATCH to update")
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


def update(db: Session, project_id: str, task_id: str, body: RecurrenceRuleUpdate) -> RecurrenceRule:
    rule = get(db, project_id, task_id)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, val)
    db.commit()
    db.refresh(rule)
    return rule


def delete(db: Session, project_id: str, task_id: str) -> None:
    db.delete(get(db, project_id, task_id))
    db.commit()
