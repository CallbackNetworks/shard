"""Workflow rules for the SPA.

Thin over ``services/rule_admin``, which ``/api/v1/workflow-rules`` calls too (ADR-0085).
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import WorkflowRuleCreate, WorkflowRuleOut, WorkflowRuleUpdate
from app.services import rule_admin

router = APIRouter(prefix="/workflow-rules", tags=["workflow-rules"])


@router.get("", response_model=list[WorkflowRuleOut])
def list_rules(project_id: str | None = None, db: Session = Depends(get_db)):
    return rule_admin.list_rules(db, project_id=project_id)


@router.post("", response_model=WorkflowRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(body: WorkflowRuleCreate, db: Session = Depends(get_db)):
    return rule_admin.create(db, body)


@router.get("/vocabulary")
def rule_vocabulary(project_id: str | None = None, db: Session = Depends(get_db)):
    """Everything the rule editor needs to render itself.

    Declared before ``/{rule_id}`` so the path parameter does not swallow it. The editor
    renders whatever this returns instead of keeping its own copy: a second place to add a
    trigger, field or action is a second place to forget one (ADR-0048, ADR-0049).
    """
    return rule_admin.vocabulary(db, project_id=project_id)


@router.get("/{rule_id}", response_model=WorkflowRuleOut)
def get_rule(rule_id: str, db: Session = Depends(get_db)):
    return rule_admin.get(db, rule_id)


@router.patch("/{rule_id}", response_model=WorkflowRuleOut)
def update_rule(rule_id: str, body: WorkflowRuleUpdate, db: Session = Depends(get_db)):
    return rule_admin.update(db, rule_id, body)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule_admin.delete(db, rule_id)


@router.post("/{rule_id}/test", response_model=dict)
async def test_rule(
    rule_id: str,
    node_id: str | None = Query(None),
    task_id: str | None = Query(None, deprecated=True, description="Alias for node_id"),
    db: Session = Depends(get_db),
):
    """Dry-run a rule against one node: would it fire, and what would each action do?"""
    return rule_admin.dry_run(db, rule_id, node_id or task_id)
