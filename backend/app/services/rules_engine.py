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
    "task.status_changed",
    "task.label_added",
    "task.priority_changed",
]

# The vocabulary the engine understands. An unrecognised field, op or action type
# evaluates to "no match" / "do nothing" *silently*, so a rule saved with a near-miss
# spelling (``title`` for ``title_contains``, ``equals`` for ``eq``) sits in the list
# looking healthy while never firing. These sets are the source of truth the schema
# layer validates against, so such a rule is rejected at write time instead.
CONDITION_FIELDS = {"status", "priority", "assignee", "title_contains", "has_label", "type", "has_role"}
CONDITION_OPS = {"eq", "neq", "contains", "in"}
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
ACTION_VALUE_ENUMS = {
    "set_status": {"todo", "in_progress", "done", "failed"},
    "set_priority": {"low", "medium", "high"},
}


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


def _eval_condition(cond: dict, task, context: dict, db: Session | None = None) -> bool:
    """Evaluate one condition against a task view or a plain ``Node`` (ADR-0049).

    Both carry ``type``/``title``/``status``/``priority``; only a task view has
    ``assignee`` (it lives in the node's ``data``), so on any other node that field
    reads as empty and an ``eq`` condition on it simply does not match.
    """
    field = cond.get("field", "")
    op = cond.get("op", "eq")
    value = cond.get("value", "")

    if field == "type":
        actual = task.type or ""
    elif field == "has_role":
        session = db if db is not None else _session_of(task)
        if session is None:
            return False
        held = graph.has_role(session, task.type, value)
        return held if op != "neq" else not held
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
        return value in label_names
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


def _skip(db: Session, node, atype: str, reason: str, detail: str) -> None:
    """Record that an action could not run, instead of doing nothing quietly.

    An action that cannot execute is the exact shape of bug this module keeps producing
    (ADR-0047/0048/0049): the rule looks like it ran, its run_count goes up, and nothing
    says why half of it did nothing. There are three ways to get here — a task-only
    action on a non-task node, a label the project does not have, and a status/priority
    value outside the enum — and all three land in the activity feed with a reason.

    Scoped to the project (and the task) so it shows up in the feed the user is actually
    looking at, not only in the global one.
    """
    is_task = _is_task(db, node)
    if is_task:
        project_id = graph.project_id_of_task(db, node.id)
    else:
        container = graph.container_of_node(db, node.id)
        project_id = container.id if container is not None else None
    log_activity(
        db,
        action="rule.skipped",
        project_id=project_id,
        task_id=node.id if is_task else None,
        actor="workflow",
        detail=detail,
        meta={"node_id": node.id, "type": node.type, "action": atype, "reason": reason},
    )
    logger.info("rule action %s skipped for node %s (%s): %s", atype, node.id, node.type, reason)


async def _fire(db: Session, node, event: str) -> None:
    """Deliver a rule-emitted event, scoped the way the subject allows (ADR-0049).

    A task hangs off its project; anything else hangs off its nearest container, or off
    nothing at all — in which case only unscoped integrations hear it.
    """
    from app.services.notifier import fire_node_notifications, fire_notifications

    if _is_task(db, node):
        await fire_notifications(db, node, event, source="rule", actor="workflow")
    else:
        await fire_node_notifications(db, node, event, source="rule", actor="workflow")


async def _exec_action(db: Session, action: dict, task):
    """Execute one rule action, returning the subject refreshed if the action changed it."""
    atype = action.get("type", "")
    value = action.get("value", "")

    if atype in TASK_ONLY_ACTIONS and not _is_task(db, task):
        _skip(
            db,
            task,
            atype,
            "not_a_task",
            f'Action "{atype}" skipped: {task.type} "{task.title}" does not play the task role',
        )
        return task

    if atype in ACTION_VALUE_ENUMS and value not in ACTION_VALUE_ENUMS[atype]:
        # Rejected at write time since ADR-0046, so only a rule saved before that can
        # hold such a value — but it would still fail in silence.
        _skip(
            db,
            task,
            atype,
            "invalid_value",
            f'Action "{atype}" skipped: "{value}" is not one of {sorted(ACTION_VALUE_ENUMS[atype])}',
        )
        return task

    if atype == "set_status":
        return await _apply_fields(db, task, {"status": value})
    elif atype == "set_priority":
        return await _apply_fields(db, task, {"priority": value})
    elif atype == "set_assignee":
        return await _apply_fields(db, task, {"assignee": value or None})
    elif atype in ("add_label", "remove_label"):
        await _apply_label(db, task, value, added=atype == "add_label")
    elif atype == "add_comment":
        from app.services.notifier import fire_notifications

        comment = Comment(
            task_id=task.id,
            project_id=graph.project_id_of_task(db, task.id),
            author="workflow",
            body=value,
        )
        db.add(comment)
        db.flush()
        await fire_notifications(db, task, "comment.created", source="rule", actor="workflow")
    elif atype == "fire_event":
        # Deferred import to avoid circular
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_fire(db, task, value))
        except Exception as exc:
            logger.warning("fire_event action failed: %s", exc)
    return task


async def _apply_label(db: Session, task: "graph.TaskView", value: str, *, added: bool) -> None:
    """Attach or detach a label through the edge dispatcher, without triggering rules."""
    from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed

    label = _resolve_label(db, task, value)
    if label is None:
        atype = "add_label" if added else "remove_label"
        _skip(
            db,
            task,
            atype,
            "label_not_found",
            f'Action "{atype}" skipped: no label named "{value}" in this project',
        )
        return
    # Same arguments either way: the caller owns the commit and the aggregate broadcast,
    # and trigger_rules=False stops task.label_added from re-entering the engine.
    opts = dict(actor="workflow", commit=False, broadcast=False, trigger_rules=False)
    if added:
        if label.id in graph.label_ids_for_task(db, task.id):
            return
        graph.set_label(db, task.id, label.id)
        db.flush()
        await dispatch_edge_added(db, task.id, label.id, graph.REL_LABELED, **opts)
    else:
        if not graph.unset_label(db, task.id, label.id):
            return
        db.flush()
        await dispatch_edge_removed(db, task.id, label.id, graph.REL_LABELED, **opts)


async def run_rules(
    db: Session,
    trigger: str,
    task,
    context: dict,
) -> None:
    """Evaluate all active rules matching the trigger and execute matching ones.

    ``task`` is the rule's subject: a ``TaskView`` on the task triggers, a plain ``Node``
    on ``node.created``, which fires for every node type (ADR-0049).

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
    if is_task:
        task_project_id = graph.project_id_of_task(db, task.id)
    else:
        container = graph.container_of_node(db, task.id)
        task_project_id = container.id if container is not None else None
    for rule in rules:
        # Check project scope
        if rule.project_id and rule.project_id != task_project_id:
            continue

        try:
            # Evaluate conditions (AND logic)
            all_match = all(_eval_condition(c, task, context, db) for c in (rule.conditions or []))
            if not all_match:
                continue

            # Execute actions. Each returns the task, refreshed when it changed it, so
            # a later action in the same rule sees the earlier one's result.
            for action in rule.actions or []:
                task = await _exec_action(db, action, task)

            rule.run_count = (rule.run_count or 0) + 1
            rule.last_run_at = datetime.now(UTC)
            db.flush()

            log_activity(
                db,
                action="rule.executed",
                project_id=task_project_id,
                task_id=task.id if is_task else None,
                actor="workflow",
                detail=f'Rule "{rule.name}" executed on {task.type} "{task.title}"',
                meta={"rule_id": rule.id, "trigger": trigger, "node_id": task.id},
            )
            logger.info("Rule '%s' executed for node '%s'", rule.name, task.title)

            await _fire(db, task, "rule.triggered")

        except Exception as exc:
            logger.warning("Rule %s failed for node %s: %s", rule.id, task.id, exc)
            db.rollback()
