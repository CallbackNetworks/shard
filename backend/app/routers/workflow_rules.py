from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkflowRule
from app.schemas import WorkflowRuleCreate, WorkflowRuleOut, WorkflowRuleUpdate
from app.services import graph

router = APIRouter(prefix="/workflow-rules", tags=["workflow-rules"])


@router.get("", response_model=list[WorkflowRuleOut])
def list_rules(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(WorkflowRule)
    if project_id:
        q = q.filter((WorkflowRule.project_id == project_id) | (WorkflowRule.project_id == None))
    return q.order_by(WorkflowRule.created_at.desc()).all()


@router.post("", response_model=WorkflowRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(body: WorkflowRuleCreate, db: Session = Depends(get_db)):
    rule = WorkflowRule(
        name=body.name,
        project_id=body.project_id,
        trigger=body.trigger,
        conditions=[c.model_dump() for c in body.conditions],
        actions=[a.model_dump() for a in body.actions],
        active=body.active,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.get("/{rule_id}", response_model=WorkflowRuleOut)
def get_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.patch("/{rule_id}", response_model=WorkflowRuleOut)
def update_rule(rule_id: str, body: WorkflowRuleUpdate, db: Session = Depends(get_db)):
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    data = body.model_dump(exclude_unset=True)
    if "conditions" in data and data["conditions"] is not None:
        data["conditions"] = [c if isinstance(c, dict) else c.model_dump() for c in data["conditions"]]
    if "actions" in data and data["actions"] is not None:
        data["actions"] = [a if isinstance(a, dict) else a.model_dump() for a in data["actions"]]
    for k, v in data.items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()


@router.post("/{rule_id}/test", response_model=dict)
async def test_rule(rule_id: str, task_id: str | None = Query(None), db: Session = Depends(get_db)):
    """Dry-run: check which actions would fire for a given task without executing them."""
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if task_id is None:
        raise HTTPException(status_code=422, detail="Either task_id query parameter is required")
    task = graph.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from app.services.rules_engine import _eval_condition

    all_match = all(_eval_condition(c, task, {}) for c in (rule.conditions or []))
    return {
        "would_fire": all_match,
        "conditions_met": [_eval_condition(c, task, {}) for c in (rule.conditions or [])],
        "actions": rule.actions if all_match else [],
    }
