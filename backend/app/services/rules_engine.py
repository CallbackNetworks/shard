"""
Workflow rules engine.
Evaluates WorkflowRule conditions against a task and executes actions.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import Comment, Label, Task, TaskLabel, WorkflowRule
from app.services import graph
from app.services.activity import log_activity

logger = logging.getLogger(__name__)

SUPPORTED_TRIGGERS = {
    "task.created",
    "task.status_changed",
    "task.label_added",
    "task.priority_changed",
}


def _eval_condition(cond: dict, task: Task, context: dict) -> bool:
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
        label_names = [tl.label.name for tl in task.task_labels if tl.label]
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


def _exec_action(db: Session, action: dict, task: Task) -> None:
    atype = action.get("type", "")
    value = action.get("value", "")

    if atype == "set_status":
        if value in ("todo", "in_progress", "done", "failed"):
            task.status = value
    elif atype == "set_priority":
        if value in ("low", "medium", "high"):
            task.priority = value
    elif atype == "set_assignee":
        task.assignee = value or None
    elif atype == "add_label":
        label = (
            db.query(Label)
            .filter(
                Label.project_id == task.project_id,
                Label.id == value,
            )
            .first()
        )
        if label:
            existing = db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == value).first()
            if not existing:
                db.add(TaskLabel(task_id=task.id, label_id=label.id))
    elif atype == "remove_label":
        db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == value).delete()
        graph.remove_edge(db, task.id, value, graph.REL_LABELED)  # bulk delete bypasses graph_sync
    elif atype == "add_comment":
        comment = Comment(
            task_id=task.id,
            project_id=task.project_id,
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
    task: Task,
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

    for rule in rules:
        # Check project scope
        if rule.project_id and rule.project_id != task.project_id:
            continue

        try:
            # Evaluate conditions (AND logic)
            all_match = all(_eval_condition(c, task, context) for c in (rule.conditions or []))
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
                project_id=task.project_id,
                task_id=task.id,
                actor="workflow",
                detail=f'Rule "{rule.name}" executed on task "{task.title}"',
                meta={"rule_id": rule.id, "trigger": trigger},
            )
            logger.info("Rule '%s' executed for task '%s'", rule.name, task.title)

        except Exception as exc:
            logger.warning("Rule %s failed for task %s: %s", rule.id, task.id, exc)
            db.rollback()
