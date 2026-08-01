from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkflowRule
from app.schemas import WorkflowRuleCreate, WorkflowRuleOut, WorkflowRuleUpdate
from app.services import graph
from app.services.rule_vocabulary import action_value_specs, condition_value_specs
from app.services.rules_engine import (
    ACTION_TYPES,
    CONDITION_FIELDS,
    CONDITION_OPS,
    SUPPORTED_TRIGGERS,
    TASK_ONLY_ACTIONS,
    TRIGGER_CONTEXT_FIELDS,
    conditions_unsupported_by,
    predict_outcome,
    rule_warnings,
    subject_for,
)

router = APIRouter(prefix="/workflow-rules", tags=["workflow-rules"])


def _with_warnings(db: Session, rule: WorkflowRule) -> WorkflowRule:
    """Attach the static warnings to a rule on its way out.

    Computed on read rather than stored: a warning is about the *world* (no such label,
    nobody subscribes), and the world changes without the rule being touched. A stored
    warning would keep accusing a rule that someone has since fixed by adding the label.
    """
    rule.warnings = rule_warnings(db, rule.actions, project_id=rule.project_id, trigger=rule.trigger)
    return rule


def _check_trigger_conditions(trigger: str, conditions) -> None:
    """Reject a rule whose conditions ask about something its trigger never supplies.

    Deliberately a 422 rather than a warning: ``rule_warnings`` describes the world and
    may come true tomorrow, but ``node.created`` will never carry a ``changed_field``.
    The rule contradicts itself, and accepting it would put yet another healthy-looking
    rule that never fires into the list (ADR-0055).
    """
    stray = conditions_unsupported_by(trigger, conditions)
    if stray:
        allowed = sorted(TRIGGER_CONTEXT_FIELDS.get(trigger, set()))
        raise HTTPException(
            status_code=422,
            detail=(
                f"condition field {stray} cannot be used with trigger '{trigger}': "
                f"it carries {allowed or 'no change fields'}"
            ),
        )


@router.get("", response_model=list[WorkflowRuleOut])
def list_rules(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(WorkflowRule)
    if project_id:
        q = q.filter((WorkflowRule.project_id == project_id) | (WorkflowRule.project_id == None))
    return [_with_warnings(db, r) for r in q.order_by(WorkflowRule.created_at.desc()).all()]


@router.post("", response_model=WorkflowRuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(body: WorkflowRuleCreate, db: Session = Depends(get_db)):
    _check_trigger_conditions(body.trigger, body.conditions)
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
def rule_vocabulary(project_id: str | None = None, db: Session = Depends(get_db)):
    """Everything the rule editor needs to render itself.

    Declared before ``/{rule_id}`` so the path parameter does not swallow it. The editor
    renders whatever this returns instead of keeping its own copy: a second place to add
    a trigger, field or action is a second place to forget one (ADR-0048, ADR-0049).
    Every value here is also what the schema validates writes against, so anything the
    editor offers is by construction something the engine understands.

    ``project_id`` narrows the label suggestions to one project's labels; without it they
    are scope-blind, matching how a global rule's label reference is resolved.
    """
    return {
        "triggers": SUPPORTED_TRIGGERS,
        # Which condition fields each trigger can carry, so the editor offers only the
        # ones that mean something there instead of letting the user build a rule the
        # write surface then rejects (ADR-0055).
        "trigger_context_fields": {k: sorted(v) for k, v in TRIGGER_CONTEXT_FIELDS.items()},
        "condition_fields": sorted(CONDITION_FIELDS),
        "condition_ops": sorted(CONDITION_OPS),
        "action_types": sorted(ACTION_TYPES),
        # What may go in the value box, per action and per condition field (ADR-0056).
        # Replaces ``action_value_enums``, which covered two of the seven actions and
        # none of the eleven condition fields, and which nothing ever read.
        "action_values": action_value_specs(db, project_id=project_id),
        "condition_values": condition_value_specs(db, project_id=project_id),
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
    # Checked against the merged result: a PATCH that changes only the trigger can strand
    # conditions that were legal under the old one.
    _check_trigger_conditions(
        data.get("trigger") or rule.trigger,
        data["conditions"] if data.get("conditions") is not None else rule.conditions,
    )
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

    A subject is not an event, so conditions about *the change that fires the rule*
    (``changed_field``, ``edge_type``…) have no answer here. They report ``null``, not
    ``false``: calling them unmet would make every ``node.updated`` rule report "would
    not fire", which is the same false green light in the opposite direction (ADR-0055).
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
    subject = subject_for(db, subject_id)

    from app.services.rules_engine import _eval_condition

    # ``db`` is required for has_label: a TaskView is not a mapped instance, so the
    # engine cannot recover a session from it and would report every label condition
    # as unmet (ADR-0045).
    met = [_eval_condition(c, subject, {}, db) for c in (rule.conditions or [])]
    # False beats null beats true: one unmet condition settles it, otherwise an
    # undecidable one leaves the answer open.
    would_fire = False if False in met else (None if None in met else True)
    outcomes = (
        [predict_outcome(db, a, subject, trigger=rule.trigger) for a in (rule.actions or [])]
        if would_fire is not False
        else []
    )
    return {
        "would_fire": would_fire,
        "conditions_met": met,
        "node": {"id": node.id, "type": node.type, "title": node.title},
        "actions": outcomes,
        "effect_count": sum(1 for o in outcomes if o["outcome"] == "applied"),
    }
