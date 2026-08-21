"""
Workflow rules engine.
Evaluates WorkflowRule conditions against a task and executes actions.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session, object_session

from app.models import Comment, WorkflowRule
from app.services import graph
from app.services.activity import log_activity

logger = logging.getLogger(__name__)

# Every moment a rule can hook onto. Ordered, because this list is served to the rule
# editor rather than copied into it — a trigger the UI offers but nothing fires is a
# rule that sits in the list looking healthy and never runs, so there is one list and a
# test pins each entry to a real ``run_rules`` call (ADR-0048).
SUPPORTED_TRIGGERS = [
    "node.created",
    "node.updated",
    "node.deleted",
    "edge.added",
    "edge.removed",
]

# The vocabulary the engine understands. An unrecognised field, op or action type
# evaluates to "no match" / "do nothing" *silently*, so a rule saved with a near-miss
# spelling (``title`` for ``title_contains``, ``equals`` for ``eq``) sits in the list
# looking healthy while never firing. These sets are the source of truth the schema
# layer validates against, so such a rule is rejected at write time instead.
CONDITION_FIELDS = {
    # What the subject *is*.
    "status",
    "priority",
    "assignee",
    "title_contains",
    "has_label",
    "type",
    "has_role",
    # What just *happened* to it (ADR-0055). These read the trigger's context rather
    # than the node, and only some triggers carry each of them.
    "changed_field",
    "edge_type",
    "edge_side",
    "other_type",
}
CONDITION_OPS = {"eq", "neq", "contains", "in"}

# Which context fields each trigger carries. A condition on a field its trigger never
# supplies is a rule that can never fire — not because the world is missing something,
# but because the rule contradicts itself — so it is rejected at write time rather than
# warned about (ADR-0055; the warning/422 line is drawn in ADR-0054).
TRIGGER_CONTEXT_FIELDS = {
    "node.created": set(),
    "node.updated": {"changed_field"},
    "node.deleted": set(),
    "edge.added": {"edge_type", "edge_side", "other_type"},
    "edge.removed": {"edge_type", "edge_side", "other_type"},
}
CONTEXT_FIELDS = set().union(*TRIGGER_CONTEXT_FIELDS.values())
ACTION_TYPES = {
    "set_status",
    "set_priority",
    "set_assignee",
    "add_label",
    "remove_label",
    "add_comment",
    "fire_event",
}

# ``node.created`` fires for every node, so a rule may now land on something that is not
# a task (ADR-0049). Every action but ``fire_event`` needs what only a task has: a data
# assignee field, a project to resolve label names against, a ``Comment.task_id``, or a
# status/priority vocabulary that is task-shaped (``ACTION_VALUE_ENUMS`` rejects a
# project's ``archived`` at write time). They are skipped *visibly* on other nodes rather
# than quietly doing nothing.
TASK_ONLY_ACTIONS = ACTION_TYPES - {"fire_event"}

# Actions whose value is a closed enum. The others take free text (an assignee name,
# a label name, a comment body) and cannot be checked ahead of time.
#
# Ordered, and ordered *meaningfully* (lifecycle, then ascending severity), because this
# is also what the editor's value dropdown renders. A set would have to be sorted to be
# served, and alphabetical order puts "done" first and reads high/low/medium — the same
# vocabulary, presented as nonsense. One ordered source, no second list to keep in step.
ACTION_VALUE_ENUMS = {
    "set_status": ("todo", "in_progress", "done", "failed"),
    "set_priority": ("low", "medium", "high"),
}

# Which end of an edge the rule is looking at. Named here rather than spelled inline at
# the dispatch site so the value the editor offers and the value the dispatcher supplies
# are the same two strings (ADR-0056).
EDGE_SIDE_SOURCE = "source"
EDGE_SIDE_TARGET = "target"
EDGE_SIDES = (EDGE_SIDE_SOURCE, EDGE_SIDE_TARGET)

# Actions that write one task field, and which field (used to compare before writing).
FIELD_ACTIONS = {"set_status": "status", "set_priority": "priority", "set_assignee": "assignee"}

# What an action actually did. "It ran" and "it changed something" are two different
# questions, and an execution record that only answers the first is as contentless as a
# ``ran 47×`` counter: a rule whose every action was a no-op reads exactly like one that
# changed the world (ADR-0053). Every action now reports one of these.
OUTCOME_APPLIED = "applied"  # ran and changed something
OUTCOME_NO_OP = "no_op"  # ran, correctly, and changed nothing — not a defect
OUTCOME_SKIPPED = "skipped"  # could not run at all (ADR-0050)
OUTCOME_FAILED = "failed"  # raised (ADR-0052)
OUTCOMES = {OUTCOME_APPLIED, OUTCOME_NO_OP, OUTCOME_SKIPPED, OUTCOME_FAILED}


def _outcome(atype: str, value, outcome: str, *, reason: str | None = None, **extra) -> dict:
    """One action's record, as stored in ``rule.executed``'s ``meta["actions"]``."""
    record = {"type": atype, "value": value, "outcome": outcome}
    if reason:
        record["reason"] = reason
    record.update(extra)
    return record


def _describe(record: dict) -> str:
    """One human-readable clause per action, for the ``rule.executed`` detail line.

    The frontend renders ``meta["actions"]`` structurally; this is what someone reading
    the plain sentence — an email digest, a log line, the activity feed's one-liner — has
    to be able to act on, so it says the outcome even when the outcome is "nothing".
    """
    atype, value, outcome = record["type"], record.get("value"), record["outcome"]
    if outcome == OUTCOME_SKIPPED:
        return f"{atype} skipped ({record.get('reason', 'unknown')})"
    if atype in FIELD_ACTIONS:
        field = FIELD_ACTIONS[atype]
        if outcome == OUTCOME_NO_OP:
            return f"{field} already {value or 'unset'}"
        return f"{field} {record.get('from') or 'unset'} -> {value or 'unset'}"
    if atype == "add_label":
        return f'label "{value}" already set' if outcome == OUTCOME_NO_OP else f'+label "{value}"'
    if atype == "remove_label":
        return f'label "{value}" was not set' if outcome == OUTCOME_NO_OP else f'-label "{value}"'
    if atype == "add_comment":
        return "commented"
    if atype == "fire_event":
        count = record.get("subscribers", 0)
        if not count:
            return f'fired "{value}" to no subscriber'
        return f'fired "{value}" to {count} subscriber{"" if count == 1 else "s"}'
    return f"{atype} {outcome}"


def _summarize(rule: WorkflowRule, node, records: list[dict]) -> str:
    """The ``rule.executed`` detail line: what the run set off, not merely that it ran."""
    subject = f'{node.type} "{node.title}"'
    if not records:
        return f'Rule "{rule.name}" ran on {subject} with no actions'
    clauses = "; ".join(_describe(record) for record in records)
    applied = sum(1 for record in records if record["outcome"] == OUTCOME_APPLIED)
    if applied == 0:
        return f'Rule "{rule.name}" ran on {subject} with no effect: {clauses}'
    return f'Rule "{rule.name}" ran on {subject}: {clauses}'


def _session_of(task) -> Session | None:
    """Best-effort session for a task.

    ``run_rules`` is handed a ``TaskView`` (node-only model, ADR-0033), which is
    not a mapped instance, so ``object_session`` raises on it; callers therefore
    pass ``db`` explicitly. The fallback keeps direct calls with a mapped ``Node``
    working.
    """
    try:
        return object_session(task)
    except Exception:
        return None


def _membership(held: bool, op: str) -> bool:
    """A set-valued field's answer. ``neq`` inverts it; everything else asserts it.

    Shared by ``has_label``, ``has_role`` and ``changed_field``: all three ask whether
    something is in a set, and ``has_label`` used to ignore the operator entirely — so
    ``has_label neq urgent`` matched exactly the tasks that *do* carry urgent (ADR-0055).
    """
    return not held if op == "neq" else held


def _in_set(values, op: str, value) -> bool:
    """Whether ``value`` (or, for ``in``, any of a list) is among ``values``."""
    wanted = value if isinstance(value, list) else [value]
    return _membership(any(v in values for v in wanted), op)


def _eval_condition(cond: dict, task, context: dict, db: Session | None = None) -> bool | None:
    """Evaluate one condition against a task view or a plain ``Node`` (ADR-0049).

    Both carry ``type``/``title``/``status``/``priority``; only a task view has
    ``assignee`` (it lives in the node's ``data``), so on any other node that field
    reads as empty and an ``eq`` condition on it simply does not match.

    Returns ``None`` — not ``False`` — for a condition about the change that triggered
    the rule when no change is at hand (ADR-0055). Only the dry-run can be in that
    position; at run time the trigger always supplies its own context fields, and a rule
    carrying a field its trigger does not supply is rejected at write time. The
    distinction matters because "this does not match" and "this cannot be judged here"
    are different answers, and reporting the second as the first is how the dry-run
    lied before ADR-0054.
    """
    field = cond.get("field", "")
    op = cond.get("op", "eq")
    value = cond.get("value", "")

    if field in CONTEXT_FIELDS:
        key = "changed" if field == "changed_field" else field
        if key not in context:
            return None
        actual = context[key]
        if isinstance(actual, list | set | tuple):
            return _in_set(actual, op, value)
        actual = actual or ""

    elif field == "type":
        actual = task.type or ""
    elif field == "has_role":
        session = db if db is not None else _session_of(task)
        if session is None:
            return False
        return _membership(graph.has_role(session, task.type, value), op)
    elif field == "status":
        actual = task.status or ""
    elif field == "priority":
        actual = task.priority or ""
    elif field == "assignee":
        actual = getattr(task, "assignee", None) or ""
    elif field == "title_contains":
        return (value.lower() in task.title.lower()) if op != "neq" else (value.lower() not in task.title.lower())
    elif field == "has_label":
        session = db if db is not None else _session_of(task)
        label_names = [lb.name for lb in graph.labels_for_task(session, task.id)] if session is not None else []
        return _in_set(label_names, op, value)
    else:
        return False

    if op == "eq":
        return actual == value
    elif op == "neq":
        return actual != value
    elif op == "in":
        return actual in (value if isinstance(value, list) else [value])
    elif op == "contains":
        return value.lower() in actual.lower()
    return False


def _resolve_label(db: Session, task: "graph.TaskView", value: str) -> "graph.LabelView | None":
    """Resolve a label action value, which may be a label id or a label name.

    Labels are project-scoped but rules are usually global, so an id pins the rule to
    one project and is useless anywhere else; a name resolves per task. Ids still work
    for rules written before names were accepted.
    """
    project_id = graph.project_id_of_task(db, task.id)
    label = graph.get_label(db, value, project_id=project_id)
    if label is not None:
        return label
    if project_id is not None:
        for candidate in graph.labels_in_project(db, project_id):
            if candidate.name == value:
                return candidate
    # The caller records the miss in the activity feed; a log line alone is invisible.
    return None


def _is_task(db: Session, node) -> bool:
    """Whether the rule's subject plays the task role (ADR-0040)."""
    return graph.has_role(db, node.type, graph.ROLE_TASK)


def subject_for(db: Session, node_id: str):
    """The rule's view of a node: a ``TaskView`` where the type plays the task role.

    A plain ``Node`` has no ``assignee`` (it lives in the node's ``data`` bag), so
    evaluating a task against one silently reports every assignee condition as unmet.
    Every entry point that hands a subject to ``run_rules`` resolves it through here.
    """
    node = graph.get_node(db, node_id)
    if node is None:
        return None
    if _is_task(db, node):
        return graph.get_task(db, node_id) or node
    return node


def conditions_unsupported_by(trigger: str, conditions) -> list[str]:
    """Condition fields this trigger never supplies — a rule that cannot ever fire.

    Distinct from ``rule_warnings``, which is about the world and may come true later.
    A ``node.created`` rule asking about ``changed_field`` is not waiting for anything;
    it is self-contradictory, so the write surface rejects it outright (ADR-0055).
    """
    allowed = TRIGGER_CONTEXT_FIELDS.get(trigger, set())
    seen = []
    for cond in conditions or []:
        field = cond.get("field", "") if isinstance(cond, dict) else getattr(cond, "field", "")
        if field in CONTEXT_FIELDS and field not in allowed and field not in seen:
            seen.append(field)
    return seen


async def _apply_fields(db: Session, task, changes: dict):
    """Write a rule's field change through the task pipeline (ADR-0048).

    A rule-made change is as real as a human-made one: it earns the same activity entry
    and the same notifications. ``trigger_rules=False`` because a rule must not trigger
    another rule; ``sync_external=False`` keeps rule-made changes out of third-party
    issue trackers, where they could echo back in as inbound events (ADR-0014).
    The caller owns the commit and the aggregate broadcast.

    Only reached for task-role nodes: every field action is in ``TASK_ONLY_ACTIONS``.
    """
    from app.services.task_mutations import apply_task_update

    return await apply_task_update(
        db,
        task.id,
        changes,
        actor="workflow",
        source="rule",
        trigger_rules=False,
        sync_external=False,
        commit=False,
        broadcast=False,
    )


def _scope_of(db: Session, node, trigger: str | None = None) -> tuple[str | None, str | None]:
    """Where an entry about this node belongs: (project_id, task_id).

    The activity feed filters by ``project_id``, so an entry written with ``None`` is
    only reachable from the global list — written but invisible where it matters. A task
    hangs off its project; anything else off its nearest container (ADR-0049/0050).

    On ``node.deleted`` the entry deliberately hangs off the project alone:
    ``delete_task_tree`` clears the activity rows pointing at the task, so an entry
    written with ``task_id`` moments before would be deleted along with it (ADR-0055).
    """
    if _is_task(db, node):
        return graph.project_id_of_task(db, node.id), (None if trigger == "node.deleted" else node.id)
    container = graph.container_of_node(db, node.id)
    return (container.id if container is not None else None), None


def _event_scope(db: Session, node):
    """Where a rule-emitted event would be delivered. Mirrors ``_fire``'s own scoping."""
    if _is_task(db, node):
        return graph.project_of_task(db, node.id)
    return graph.container_of_node(db, node.id)


def _field_target(field: str, value):
    """The value a field action would write. Empty means "unset" for a free-text field."""
    return (value or None) if field == "assignee" else value


def predict_outcome(db: Session, action: dict, node, *, trigger: str | None = None) -> dict:
    """What this action would do to this node — computed without doing it (ADR-0054).

    The single source of truth for three surfaces that must never disagree: the engine
    (which then performs whatever this says would happen), the dry-run endpoint, and the
    save-time warning on a rule. Two implementations of "would this work" is one more than
    can be kept in step, and the one that drifts is the one telling the user their rule is
    fine.

    Returns the same record shape ``_exec_action`` records, so a prediction and an
    execution of the same action read identically in the API and in the UI.
    Never writes: no activity entry, no delivery, no label edge.
    """
    atype = action.get("type", "")
    value = action.get("value", "")

    # The subject is still there — rules run before the teardown — but it is on its way
    # out, so writing to it is writing to something nobody will ever read (ADR-0055).
    # Firing an event is the one thing that still means something on a deletion.
    if trigger == "node.deleted" and atype != "fire_event":
        return _outcome(atype, value, OUTCOME_SKIPPED, reason="node_deleted")

    if atype in TASK_ONLY_ACTIONS and not _is_task(db, node):
        return _outcome(atype, value, OUTCOME_SKIPPED, reason="not_a_task")

    if atype in ACTION_VALUE_ENUMS and value not in ACTION_VALUE_ENUMS[atype]:
        return _outcome(atype, value, OUTCOME_SKIPPED, reason="invalid_value")

    if atype in FIELD_ACTIONS:
        field = FIELD_ACTIONS[atype]
        current = getattr(node, field, None)
        # Setting a field to what it already holds is legitimate — an idempotent rule is
        # a correct rule — but it is not a change, and the pipeline downstream fires
        # nothing for it. Comparing here is what lets the record say so.
        if (current or None) == (_field_target(field, value) or None):
            return _outcome(atype, value, OUTCOME_NO_OP, reason="unchanged")
        return _outcome(atype, value, OUTCOME_APPLIED, **{"from": current})

    if atype in ("add_label", "remove_label"):
        label = _resolve_label(db, node, value)
        if label is None:
            return _outcome(atype, value, OUTCOME_SKIPPED, reason="label_not_found")
        held = label.id in graph.label_ids_for_task(db, node.id)
        if atype == "add_label" and held:
            return _outcome(atype, value, OUTCOME_NO_OP, reason="already_labelled", label_id=label.id)
        if atype == "remove_label" and not held:
            return _outcome(atype, value, OUTCOME_NO_OP, reason="not_labelled", label_id=label.id)
        return _outcome(atype, value, OUTCOME_APPLIED, label_id=label.id)

    if atype == "add_comment":
        # Always a change: a comment identical to the previous one is still a new comment.
        return _outcome(atype, value, OUTCOME_APPLIED)

    if atype == "fire_event":
        # An event nobody subscribed to is the silent empty set of ADR-0047 seen from the
        # sending end: the rule does its part, and it reaches no one.
        from app.services.notifier import count_subscribers

        subscribers = count_subscribers(db, _event_scope(db, node), value, source="rule")
        return _outcome(
            atype,
            value,
            OUTCOME_APPLIED if subscribers else OUTCOME_NO_OP,
            reason=None if subscribers else "no_subscribers",
            subscribers=subscribers,
        )

    # Unreachable while ACTION_TYPES is validated at write time (ADR-0046); reported
    # rather than ignored so a future action type added to the vocabulary but not to this
    # dispatch shows up instead of vanishing.
    return _outcome(atype, value, OUTCOME_SKIPPED, reason="unknown_action")


def rule_warnings(db: Session, actions, *, project_id: str | None = None, trigger: str | None = None) -> list[dict]:
    """Which of a rule's actions cannot work for *any* subject (ADR-0054).

    ``predict_outcome`` answers "what would this do to this task". This answers the
    question that has no subject — the one worth asking the moment a rule is saved: does
    this action reference a label that exists, an event anyone subscribes to? A rule can
    only be found broken today by waiting for it to fire and then reading the feed.

    A warning, never a 422. A label may be added tomorrow, an integration may subscribe
    next week, and a global rule that is dead in one project is alive in another; refusing
    the write would make a legitimate rule unsaveable. Records share the outcome shape so
    the same chips render a warning and an execution.
    """
    from app.services.notifier import event_has_subscriber

    found: list[dict] = []
    for action in actions or []:
        atype = action.get("type", "") if isinstance(action, dict) else getattr(action, "type", "")
        value = action.get("value", "") if isinstance(action, dict) else getattr(action, "value", "")
        if trigger == "node.deleted" and atype != "fire_event":
            # Subjectless by construction: nothing that gets deleted is worth writing to
            # (ADR-0055), so this one is knowable the moment the rule is saved.
            found.append(_outcome(atype, value, OUTCOME_SKIPPED, reason="node_deleted"))
        elif atype in ("add_label", "remove_label"):
            if not graph.label_ref_exists(db, value, project_id=project_id):
                found.append(_outcome(atype, value, OUTCOME_SKIPPED, reason="label_not_found"))
        elif atype == "fire_event":
            if not event_has_subscriber(db, value, source="rule"):
                found.append(_outcome(atype, value, OUTCOME_NO_OP, reason="no_subscribers", subscribers=0))
    return found


# Why an action could not run, said in full. One definition, because the activity entry
# and the dry-run response are describing the same prediction.
_SKIP_DETAILS = {
    "not_a_task": lambda r, n: f'Action "{r["type"]}" skipped: {n.type} "{n.title}" does not play the task role',
    "invalid_value": lambda r, n: (
        f'Action "{r["type"]}" skipped: "{r.get("value")}" is not one of {list(ACTION_VALUE_ENUMS[r["type"]])}'
    ),
    "label_not_found": lambda r, n: f'Action "{r["type"]}" skipped: no label named "{r.get("value")}" in this project',
    "node_deleted": lambda r, n: (
        f'Action "{r["type"]}" skipped: {n.type} "{n.title}" is being deleted, so writing to it would be lost'
    ),
    "unknown_action": lambda r, n: f'Action "{r["type"]}" skipped: the engine has no implementation for it',
}


def skip_detail(record: dict, node) -> str:
    """The human-readable reason a skipped action could not run."""
    describe = _SKIP_DETAILS.get(record.get("reason", ""))
    if describe is None:
        return f'Action "{record["type"]}" skipped: {record.get("reason", "unknown")}'
    return describe(record, node)


def _skip(db: Session, node, record: dict, rule: WorkflowRule | None = None, trigger: str | None = None) -> dict:
    """Record that an action could not run, instead of doing nothing quietly.

    An action that cannot execute is the exact shape of bug this module keeps producing
    (ADR-0047/0048/0049): the rule looks like it ran, its run_count goes up, and nothing
    says why half of it did nothing. There are three ways to get here — a task-only
    action on a non-task node, a label the project does not have, and a status/priority
    value outside the enum — and all three land in the activity feed with a reason.
    An action that *raises* is the fourth; see ``_failed``.

    ``rule`` is threaded in so the entry can say *which* rule skipped: without it the feed
    could report "add_label skipped: no label named security" and leave the reader to
    guess which of their rules said that.
    """
    atype, reason = record["type"], record.get("reason", "unknown")
    project_id, task_id = _scope_of(db, node, trigger)
    meta = {"node_id": node.id, "type": node.type, "action": atype, "reason": reason}
    if rule is not None:
        meta["rule_id"] = rule.id
        meta["rule_name"] = rule.name
    log_activity(
        db,
        action="rule.skipped",
        project_id=project_id,
        task_id=task_id,
        actor="workflow",
        detail=skip_detail(record, node),
        meta=meta,
    )
    logger.info("rule action %s skipped for node %s (%s): %s", atype, node.id, node.type, reason)
    return record


def _failed(db: Session, rule: WorkflowRule, node, exc: Exception) -> None:
    """Record that a rule raised, instead of leaving it to a log line nobody reads.

    The fourth way a rule can do nothing. The other three are deliberate and land in the
    feed via ``_skip``; this one is a genuine defect and used to be the *least* visible of
    the four — the rule's run_count did not even move, so the list showed a rule that
    looked idle rather than broken.
    """
    project_id, task_id = _scope_of(db, node)
    log_activity(
        db,
        action="rule.failed",
        project_id=project_id,
        task_id=task_id,
        actor="workflow",
        detail=f'Rule "{rule.name}" failed on {node.type} "{node.title}": {exc}',
        meta={
            "rule_id": rule.id,
            "node_id": node.id,
            "type": node.type,
            "error": f"{type(exc).__name__}: {exc}",
        },
    )


async def _fire(db: Session, node, event: str) -> int:
    """Deliver a rule-emitted event, scoped the way the subject allows (ADR-0049).

    A task hangs off its project; anything else hangs off its nearest container, or off
    nothing at all — in which case only unscoped integrations hear it. Returns how many
    integrations were subscribed, because "fired" and "reached somebody" are different
    facts and the execution record has to distinguish them (ADR-0053).
    """
    from app.services.notifier import fire_node_notifications, fire_notifications

    if _is_task(db, node):
        return await fire_notifications(db, node, event, source="rule", actor="workflow", trigger_rules=False)
    return await fire_node_notifications(db, node, event, source="rule", actor="workflow", trigger_rules=False)


async def _exec_action(
    db: Session, action: dict, task, rule: WorkflowRule | None = None, trigger: str | None = None
) -> tuple[object, dict]:
    """Execute one rule action.

    Execution is prediction plus the write: ``predict_outcome`` decides what this action
    would do, and this function performs exactly that. Keeping one decision means the
    dry-run and the save-time warning cannot disagree with what actually happens — two
    implementations of "would this work" is one more than can be kept in step (ADR-0054).

    Returns the subject (refreshed if the action changed it) and the record of what the
    action did — see ``_outcome``.
    """
    record = predict_outcome(db, action, task, trigger=trigger)
    atype, value, outcome = record["type"], record.get("value"), record["outcome"]

    if outcome == OUTCOME_SKIPPED:
        return task, _skip(db, task, record, rule, trigger)
    if outcome == OUTCOME_NO_OP:
        # Nothing left to do, by definition: the field already holds the value, the label
        # is already (or already not) attached, the event has nobody to reach.
        return task, record

    if atype in FIELD_ACTIONS:
        field = FIELD_ACTIONS[atype]
        return await _apply_fields(db, task, {field: _field_target(field, value)}), record

    if atype in ("add_label", "remove_label"):
        await _write_label(db, task, record["label_id"], added=atype == "add_label")
        return task, record

    if atype == "add_comment":
        from app.services.notifier import fire_notifications

        comment = Comment(
            task_id=task.id,
            project_id=graph.project_id_of_task(db, task.id),
            author="workflow",
            body=value,
        )
        db.add(comment)
        db.flush()
        record["subscribers"] = await fire_notifications(
            db, task, "comment.created", source="rule", actor="workflow", trigger_rules=False
        )
        return task, record

    if atype == "fire_event":
        # Awaited like every other action. This used to be a bare ``loop.create_task``
        # left over from when ``_exec_action`` was synchronous: it delivered only because
        # the ``rule.triggered`` await further down happened to give it a turn, it dropped
        # the event entirely with no running loop, and its exceptions went unobserved.
        # The count is re-read from the delivery rather than kept from the prediction:
        # the record reports what happened, not what was expected to happen.
        record["subscribers"] = await _fire(db, task, value)
        return task, record

    # Unreachable: ``predict_outcome`` skips any type it has no branch for, and a guard
    # test pins both dispatches to ACTION_TYPES. Kept so an action added to prediction but
    # not here degrades to a visible skip instead of a silent success.
    return task, _skip(db, task, _outcome(atype, value, OUTCOME_SKIPPED, reason="unknown_action"), rule, trigger)


async def _write_label(db: Session, task: "graph.TaskView", label_id: str, *, added: bool) -> None:
    """Attach or detach a label through the edge dispatcher, without triggering rules.

    Only reached when ``predict_outcome`` has already established that the label exists
    and that this would change something.
    """
    from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed

    # Same arguments either way: the caller owns the commit and the aggregate broadcast,
    # and trigger_rules=False stops the edge.added it writes from re-entering the engine.
    opts = dict(actor="workflow", commit=False, broadcast=False, trigger_rules=False)
    if added:
        graph.set_label(db, task.id, label_id)
        db.flush()
        await dispatch_edge_added(db, task.id, label_id, graph.REL_LABELED, **opts)
    else:
        graph.unset_label(db, task.id, label_id)
        db.flush()
        await dispatch_edge_removed(db, task.id, label_id, graph.REL_LABELED, **opts)


async def run_rules(
    db: Session,
    trigger: str,
    task,
    context: dict,
) -> None:
    """Evaluate all active rules matching the trigger and execute matching ones.

    ``task`` is the rule's subject: a ``TaskView`` for a task-role node, a plain ``Node``
    otherwise. Every trigger now fires for every node type — creation, field changes,
    deletion, and either end of an edge (ADR-0055).

    ``context`` carries what just happened: ``changed`` for ``node.updated``, and
    ``edge_type``/``edge_side``/``other_type`` for the edge triggers. Conditions on those
    fields are what narrow a generic trigger back down to a specific event.

    Rules never chain: every write a rule makes is dispatched with ``trigger_rules=False``,
    so this function is never re-entered from its own actions (ADR-0048). The depth
    counter this used to carry was dead — nothing ever incremented it, because actions
    wrote to the database directly instead of going back through a write surface.
    """
    rules = (
        db.query(WorkflowRule)
        .filter(
            WorkflowRule.active == True,
            WorkflowRule.trigger == trigger,
        )
        .all()
    )
    if not rules:
        return

    is_task = _is_task(db, task)
    task_project_id, task_scope_id = _scope_of(db, task, trigger)
    node_id = task.id
    for rule in rules:
        # Check project scope
        if rule.project_id and rule.project_id != task_project_id:
            continue

        try:
            # A savepoint per rule. A failure here used to ``db.rollback()`` the whole
            # session, which discarded whatever earlier rules had already done — and,
            # on the paths that leave the commit to the caller, the very write that
            # triggered this run. One rule's defect is now one rule's problem.
            with db.begin_nested():
                # Conditions are ANDed. ``is True`` rather than a plain truth test: an
                # undecidable condition (ADR-0055) must not fire the rule, and the only
                # way to get one here would be a rule whose trigger does not supply the
                # field — which the write surface rejects.
                if not all(_eval_condition(c, task, context, db) is True for c in (rule.conditions or [])):
                    continue

                # Execute actions. Each returns the task, refreshed when it changed it,
                # so a later action in the same rule sees the earlier one's result, plus
                # a record of what it actually did.
                records: list[dict] = []
                for action in rule.actions or []:
                    task, record = await _exec_action(db, action, task, rule, trigger)
                    records.append(record)

                effects = sum(1 for record in records if record["outcome"] == OUTCOME_APPLIED)
                rule.run_count = (rule.run_count or 0) + 1
                # Counted separately from run_count, which answers "did it fire" and has
                # been read as "did it do something" ever since it was the only number on
                # the card. A rule at 47 runs / 0 effects is doing nothing, loudly.
                if effects:
                    rule.effect_count = (rule.effect_count or 0) + 1
                rule.last_run_at = datetime.now(UTC)
                db.flush()

                log_activity(
                    db,
                    action="rule.executed",
                    project_id=task_project_id,
                    task_id=task_scope_id,
                    actor="workflow",
                    detail=_summarize(rule, task, records),
                    meta={
                        "rule_id": rule.id,
                        "rule_name": rule.name,
                        "trigger": trigger,
                        "node_id": node_id,
                        "actions": records,
                        "effect_count": effects,
                    },
                )
                logger.info("Rule '%s' ran on node '%s' (%d/%d applied)", rule.name, task.title, effects, len(records))

            await _fire(db, task, "rule.triggered")

        except Exception as exc:
            logger.warning("Rule %s failed for node %s: %s", rule.id, node_id, exc)
            # The savepoint is already rolled back; the subject may be stale with it.
            if is_task:
                task = graph.get_task(db, node_id) or task
            try:
                _failed(db, rule, task, exc)
            except Exception:
                # Best-effort: recording the failure must not turn one broken rule into
                # a failed request for the write that triggered it.
                logger.exception("could not record rule failure for rule %s", rule.id)
