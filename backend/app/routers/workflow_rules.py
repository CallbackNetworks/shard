from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkflowRule
from app.schemas import WorkflowRuleCreate, WorkflowRuleOut, WorkflowRuleUpdate
from app.services import graph
from app.services.rules_engine import (
    ACTION_TYPES,
    ACTION_VALUE_ENUMS,
    CONDITION_FIELDS,
    CONDITION_OPS,
    SUPPORTED_TRIGGERS,
    TASK_ONLY_ACTIONS,
    predict_outcome,
    rule_warnings,
)

router = APIRouter(prefix="/workflow-rules", tags=["workflow-rules"])


def _with_warnings(db: Session, rule: WorkflowRule) -> WorkflowRule:
    """Attach the static warnings to a rule on its way out.

    Computed on read rather than stored: a warning is about the *world* (no such label,
    nobody subscribes), and the world changes without the rule being touched. A stored
    warning would keep accusing a rule that someone has since fixed by adding the label.
    """
    rule.warnings = rule_warnings(db, rule.actions, project_id=rule.project_id)
    return rule


@router.get("", response_model=list[WorkflowRuleOut])
def list_rules(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(WorkflowRule)
    if project_id:
        q = q.filter((WorkflowRule.project_id == project_id) | (WorkflowRule.project_id == None))
    return [_with_warnings(db, r) for r in q.order_by(WorkflowRule.created_at.desc()).all()]


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
    return _with_warnings(db, rule)


@router.get("/vocabulary")
def rule_vocabulary():
    """Everything the rule editor needs to render itself.

    Declared before ``/{rule_id}`` so the path parameter does not swallow it. The editor
    renders whatever this returns instead of keeping its own copy: a second place to add
    a trigger, field or action is a second place to forget one (ADR-0048, ADR-0049).
    Every value here is also what the schema validates writes against, so anything the
    editor offers is by construction something the engine understands.
    """
    return {
        "triggers": SUPPORTED_TRIGGERS,
        "condition_fields": sorted(CONDITION_FIELDS),
        "condition_ops": sorted(CONDITION_OPS),
        "action_types": sorted(ACTION_TYPES),
        "action_value_enums": {k: sorted(v) for k, v in ACTION_VALUE_ENUMS.items()},
        "task_only_actions": sorted(TASK_ONLY_ACTIONS),
    }


@router.get("/{rule_id}", response_model=WorkflowRuleOut)
def get_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return _with_warnings(db, rule)


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
    return _with_warnings(db, rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()


@router.post("/{rule_id}/test", response_model=dict)
async def test_rule(
    rule_id: str,
    node_id: str | None = Query(None),
    task_id: str | None = Query(None, deprecated=True, description="Alias for node_id"),
    db: Session = Depends(get_db),
):
    """Dry-run a rule against one node: would it fire, and what would each action do?

    ``actions`` used to be ``rule.actions`` echoed back verbatim — the rule's own
    configuration returned as if it were a result. It reported "would fire: add_label
    security" for a rule that skipped every single time because no such label existed.
    Each action is now put through the engine's own ``predict_outcome``, so the dry-run
    answers with the same four-value vocabulary an execution records, and cannot say
    something the engine would not do (ADR-0053, ADR-0054).

    Any node, not only a task: rules trigger on ``node.created`` for every type
    (ADR-0049), and the answer for a non-task subject — every task-only action skipped —
    is exactly what the user needs to see.
    """
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    subject_id = node_id or task_id
    if subject_id is None:
        raise HTTPException(status_code=422, detail="node_id query parameter is required")
    node = graph.get_node(db, subject_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    # A task-role node is evaluated as a TaskView: assignee lives in the node's data bag,
    # so a plain Node would report every assignee condition as unmet.
    subject = (graph.get_task(db, subject_id) or node) if graph.has_role(db, node.type, graph.ROLE_TASK) else node

    from app.services.rules_engine import _eval_condition

    # ``db`` is required for has_label: a TaskView is not a mapped instance, so the
    # engine cannot recover a session from it and would report every label condition
    # as unmet (ADR-0045).
    met = [_eval_condition(c, subject, {}, db) for c in (rule.conditions or [])]
    would_fire = all(met)
    outcomes = [predict_outcome(db, a, subject) for a in (rule.actions or [])] if would_fire else []
    return {
        "would_fire": would_fire,
        "conditions_met": met,
        "node": {"id": node.id, "type": node.type, "title": node.title},
        "actions": outcomes,
        "effect_count": sum(1 for o in outcomes if o["outcome"] == "applied"),
    }
