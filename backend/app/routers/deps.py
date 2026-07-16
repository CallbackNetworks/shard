from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    Comment,
    Cycle,
    Goal,
    Identity,
    Integration,
    Label,
    Project,
    Task,
)
from app.services import graph


def get_project_or_404(project_id: str, db: Session) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_task_or_404(task_id: str, db: Session, *, project_id: str | None = None) -> Task:
    # Project scoping is by graph ``contains`` membership (ADR-0032, no primary).
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or (project_id and task_id not in graph.contained_task_ids(db, project_id)):
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def get_label_or_404(label_id: str, db: Session, *, project_id: str | None = None) -> Label:
    query = db.query(Label).filter(Label.id == label_id)
    if project_id:
        query = query.filter(Label.project_id == project_id)
    label = query.first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    return label


def get_cycle_or_404(cycle_id: str, db: Session, *, project_id: str | None = None) -> Cycle:
    query = db.query(Cycle).filter(Cycle.id == cycle_id)
    if project_id:
        query = query.filter(Cycle.project_id == project_id)
    cycle = query.first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle


def get_identity_or_404(identity_id: str, db: Session) -> Identity:
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    return identity


def get_goal_or_404(goal_id: str, db: Session) -> Goal:
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


def get_integration_or_404(integration_id: str, db: Session) -> Integration:
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    return integration


def get_comment_or_404(comment_id: str, db: Session, *, task_id: str | None = None) -> Comment:
    query = db.query(Comment).filter(Comment.id == comment_id)
    if task_id:
        query = query.filter(Comment.task_id == task_id)
    comment = query.first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment
