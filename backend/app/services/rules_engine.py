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

SUPPORTED_TRIGGERS = {
    "task.created",
    "task.status_changed",
    "task.label_added",
    "task.priority_changed",
}

# The vocabulary the engine understands. An unrecognised field, op or action type
# evaluates to "no match" / "do nothing" *silently*, so a rule saved with a near-miss
# spelling (``title`` for ``title_contains``, ``equals`` for ``eq``) sits in the list
# looking healthy while never firing. These sets are the source of truth the schema
# layer validates against, so such a rule is rejected at write time instead.
CONDITION_FIELDS = {"status", "priority", "assignee", "title_contains", "has_label"}
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


def _eval_condition(cond: dict, task: "graph.TaskView", context: dict, db: Session | None = None) -> bool:
    field = cond.get("field", "")
    op = cond.get("op", "eq")
    value = cond.get("value", "")

    if field == "status":
        actual = task.status
    elif field == "priority":
        actual = task.priority
    elif field == "assignee":
        actual = task.assignee or ""
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
    logger.warning("workflow action label %r not found for task %s", value, task.id)
    return None


def _exec_action(db: Session, action: dict, task: "graph.TaskView") -> None:
    atype = action.get("type", "")
    value = action.get("value", "")

    # Task is node-only (ADR-0033): persist via graph.update_task and mirror onto
    # the in-memory view so later conditions in this run see the new value.
    if atype == "set_status":
        if value in ("todo", "in_progress", "done", "failed"):
            graph.update_task(db, task.id, status=value)
            task.status = value
    elif atype == "set_priority":
        if value in ("low", "medium", "high"):
            graph.update_task(db, task.id, priority=value)
            task.priority = value
    elif atype == "set_assignee":
        graph.update_task(db, task.id, assignee=value or None)
        task.assignee = value or None
    elif atype == "add_label":
        label = _resolve_label(db, task, value)
        if label is not None:
            graph.set_label(db, task.id, label.id)
    elif atype == "remove_label":
        label = _resolve_label(db, task, value)
        if label is not None:
            graph.unset_label(db, task.id, label.id)
    elif atype == "add_comment":
        comment = Comment(
            task_id=task.id,
            project_id=graph.project_id_of_task(db, task.id),
            author="workflow",
            body=value,
        )
        db.add(comment)
    elif atype == "fire_event":
        # Deferred import to avoid circular
        import asyncio

        from app.services.notifier import fire_notifications

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(fire_notifications(db, task, value))
        except Exception as exc:
            logger.warning("fire_event action failed: %s", exc)


async def run_rules(
    db: Session,
    trigger: str,
    task: "graph.TaskView",
    context: dict,
) -> None:
    """
    Evaluate all active rules matching the trigger and execute matching ones.
    context dict may include _rule_depth (int) to prevent recursion.
    """
    if context.get("_rule_depth", 0) >= 2:
        return

    rules = (
        db.query(WorkflowRule)
        .filter(
            WorkflowRule.active == True,
            WorkflowRule.trigger == trigger,
        )
        .all()
    )

    task_project_id = graph.project_id_of_task(db, task.id)
    for rule in rules:
        # Check project scope
        if rule.project_id and rule.project_id != task_project_id:
            continue

        try:
            # Evaluate conditions (AND logic)
            all_match = all(_eval_condition(c, task, context, db) for c in (rule.conditions or []))
            if not all_match:
                continue

            # Execute actions
            for action in rule.actions or []:
                _exec_action(db, action, task)

            rule.run_count = (rule.run_count or 0) + 1
            rule.last_run_at = datetime.now(UTC)
            db.flush()

            log_activity(
                db,
                action="rule.executed",
                project_id=task_project_id,
                task_id=task.id,
                actor="workflow",
                detail=f'Rule "{rule.name}" executed on task "{task.title}"',
                meta={"rule_id": rule.id, "trigger": trigger},
            )
            logger.info("Rule '%s' executed for task '%s'", rule.name, task.title)

            # Deferred import: notifier does not import this module, but the
            # fire_event action already reaches into it the same way.
            from app.services.notifier import fire_notifications

            await fire_notifications(db, task, "rule.triggered")

        except Exception as exc:
            logger.warning("Rule %s failed for task %s: %s", rule.id, task.id, exc)
            db.rollback()
