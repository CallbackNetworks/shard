"""Workflow rules: the act, for both doors (ADR-0085).

The rules engine (ADR-0047→0056) is the platform's whole automation layer, and every way of
touching it — list, create, update, delete, the vocabulary, the dry-run — lived only on the
internal ``/api``. In production that is behind the password gate, so "set this up once and
let it run" was a thing only a person in a browser could arrange. An agent could perform
each individual write forever and never automate one.

``write`` scope for the mutations, ``read`` for the reads. A rule's actions are ordinary
writes — set a field, add or remove a label, add a comment, fire an event to integrations
that already exist (``rules_engine._exec_action``) — so a key that may write gains no reach
it did not have. What it gains is *persistence*, which is the point of the feature.

``vocabulary`` matters more here than it does for the editor it was built for: an agent
composing a rule has no picker to constrain it, so this is the only thing standing between
it and a rule the write surface rejects — or worse, accepts and never fires.
"""

from sqlalchemy.orm import Session

from app.models import WorkflowRule
from app.schemas import WorkflowRuleCreate, WorkflowRuleUpdate
from app.services import graph
from app.services.errors import NotFound, Unprocessable
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


def with_warnings(db: Session, rule: WorkflowRule) -> WorkflowRule:
    """Attach the static warnings to a rule on its way out.

    Computed on read rather than stored: a warning is about the *world* (no such label,
    nobody subscribes), and the world changes without the rule being touched. A stored
    warning would keep accusing a rule that someone has since fixed by adding the label.
    """
    rule.warnings = rule_warnings(db, rule.actions, project_id=rule.project_id, trigger=rule.trigger)
    return rule


def _check_trigger_conditions(trigger: str, conditions) -> None:
    """Reject a rule whose conditions ask about something its trigger never supplies.

    Deliberately a 422 rather than a warning: ``rule_warnings`` describes the world and may
    come true tomorrow, but ``node.created`` will never carry a ``changed_field``. The rule
    contradicts itself, and accepting it would put yet another healthy-looking rule that
    never fires into the list (ADR-0055).
    """
    stray = conditions_unsupported_by(trigger, conditions)
    if stray:
        allowed = sorted(TRIGGER_CONTEXT_FIELDS.get(trigger, set()))
        raise Unprocessable(
            f"condition field {stray} cannot be used with trigger '{trigger}': "
            f"it carries {allowed or 'no change fields'}"
        )


def _check_trigger_known(db: Session, trigger: str) -> None:
    """Reject a trigger that is neither a structural trigger nor a triggerable event.

    Moved here rather than a pydantic validator (ADR-0106): which named events are
    triggerable depends on the notification catalog, which needs a session to read the same
    way ``Integration.events`` already does (``event_catalog.validate_events``).
    """
    from app.services.event_catalog import validate_trigger

    try:
        validate_trigger(db, trigger)
    except ValueError as exc:
        raise Unprocessable(str(exc)) from exc


def load(db: Session, rule_id: str) -> WorkflowRule:
    rule = db.query(WorkflowRule).filter(WorkflowRule.id == rule_id).first()
    if not rule:
        raise NotFound("Rule not found")
    return rule


def list_rules(db: Session, *, project_id: str | None = None) -> list[WorkflowRule]:
    q = db.query(WorkflowRule)
    if project_id:
        # A global rule (project_id NULL) applies to this project too, so it belongs in the
        # answer — the same reasoning ADR-0047 had to apply to unscoped integrations.
        q = q.filter((WorkflowRule.project_id == project_id) | (WorkflowRule.project_id == None))
    return [with_warnings(db, r) for r in q.order_by(WorkflowRule.created_at.desc()).all()]


def get(db: Session, rule_id: str) -> WorkflowRule:
    return with_warnings(db, load(db, rule_id))


def create(db: Session, body: WorkflowRuleCreate) -> WorkflowRule:
    _check_trigger_known(db, body.trigger)
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
    return with_warnings(db, rule)


def update(db: Session, rule_id: str, body: WorkflowRuleUpdate) -> WorkflowRule:
    rule = load(db, rule_id)
    data = body.model_dump(exclude_unset=True)
    if "conditions" in data and data["conditions"] is not None:
        data["conditions"] = [c if isinstance(c, dict) else c.model_dump() for c in data["conditions"]]
    if "actions" in data and data["actions"] is not None:
        data["actions"] = [a if isinstance(a, dict) else a.model_dump() for a in data["actions"]]
    # Checked against the merged result: a PATCH that changes only the trigger can strand
    # conditions that were legal under the old one.
    merged_trigger = data.get("trigger") or rule.trigger
    if "trigger" in data and data["trigger"] is not None:
        _check_trigger_known(db, merged_trigger)
    _check_trigger_conditions(
        merged_trigger,
        data["conditions"] if data.get("conditions") is not None else rule.conditions,
    )
    for k, v in data.items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return with_warnings(db, rule)


def delete(db: Session, rule_id: str) -> None:
    db.delete(load(db, rule_id))
    db.commit()


def vocabulary(db: Session, *, project_id: str | None = None) -> dict:
    """Everything needed to compose a rule this engine will actually run.

    Built for the editor (ADR-0056) and just as load-bearing for an agent: every value here
    is what the schema validates writes against, so anything offered is by construction
    something the engine understands.
    """
    from app.services.event_catalog import TRIGGERABLE_EVENTS

    return {
        # The merged catalog (ADR-0106): a rule may trigger on either kind, so this is the
        # one flat list a caller validates a ``trigger`` value against. The two halves below
        # are split out purely so an editor can group its picker the way the events catalog
        # already groups the integration event checklist.
        "triggers": SUPPORTED_TRIGGERS + TRIGGERABLE_EVENTS,
        "structural_triggers": SUPPORTED_TRIGGERS,
        "event_triggers": TRIGGERABLE_EVENTS,
        # Which condition fields each trigger can carry, so a composer offers only the ones
        # that mean something there instead of building a rule the write surface then
        # rejects (ADR-0055). Event triggers carry no change-context fields (the event name
        # already encodes what happened), so they are absent here and fall back to "none".
        "trigger_context_fields": {k: sorted(v) for k, v in TRIGGER_CONTEXT_FIELDS.items()},
        "condition_fields": sorted(CONDITION_FIELDS),
        "condition_ops": sorted(CONDITION_OPS),
        "action_types": sorted(ACTION_TYPES),
        # What may go in the value box, per action and per condition field (ADR-0056).
        "action_values": action_value_specs(db, project_id=project_id),
        "condition_values": condition_value_specs(db, project_id=project_id),
        "task_only_actions": sorted(TASK_ONLY_ACTIONS),
    }


def dry_run(db: Session, rule_id: str, node_id: str | None) -> dict:
    """Would this rule fire against this node, and what would each action do?

    ``actions`` used to be ``rule.actions`` echoed back verbatim — the rule's own
    configuration returned as if it were a result. Each action goes through the engine's own
    ``predict_outcome``, so the dry-run answers with the same vocabulary an execution
    records and cannot say something the engine would not do (ADR-0053, ADR-0054).

    Any node, not only a task: rules trigger on ``node.created`` for every type (ADR-0049),
    and the answer for a non-task subject — every task-only action skipped — is exactly what
    the caller needs to see.
    """
    rule = load(db, rule_id)
    if node_id is None:
        raise Unprocessable("node_id query parameter is required")
    node = graph.get_node(db, node_id)
    if node is None:
        raise NotFound("Node not found")
    # A task-role node is evaluated as a TaskView: assignee lives in the node's data bag,
    # so a plain Node would report every assignee condition as unmet.
    subject = subject_for(db, node_id)

    from app.services.rules_engine import _eval_condition

    # ``db`` is required for has_label: a TaskView is not a mapped instance, so the engine
    # cannot recover a session from it and would report every label condition unmet (ADR-0045).
    met = [_eval_condition(c, subject, {}, db) for c in (rule.conditions or [])]
    # False beats null beats true: one unmet condition settles it, otherwise an undecidable
    # one leaves the answer open. A subject is not an event, so conditions about *the change
    # that fires the rule* report null, not false (ADR-0055).
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
