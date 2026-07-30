"""Unified task mutation pipeline (ADR-0038).

Every entry point that mutates a task (web SPA, external API, SPA bulk
actions, CI/CD webhook callbacks, assistant tools) must run the same
post-mutation pipeline: activity logging, outbound notifications,
external issue sync, workflow rules, and WebSocket broadcast. Before this
service existed each router reimplemented the sequence with drift — bulk
and external-API paths silently skipped rules and notifications.

Callers keep surface-specific concerns: request validation, re-parenting
(graph move), serialization (enrich_task vs TaskOut), and their own HTTP
error formats. ``AgentKeyError`` is raised instead of HTTPException so the
service stays framework-free; routers translate it to a 400.
"""

from sqlalchemy.orm import Session

from app.models import ApiKey
from app.services import graph
from app.services.activity import log_activity
from app.services.notifier import fire_notifications
from app.services.rules_engine import run_rules
from app.services.ws_manager import ws_manager

# Suffix appended to human-readable activity details, keyed by source.
_SOURCE_SUFFIX = {
    "web": "",
    "api": " via API",
    "bulk": " via bulk update",
    "webhook": " via webhook",
    "assistant": " via assistant",
    "node": " via graph API",
    "import": " via import",
    "pr": " by pull request",
    "issue-sync": " via issue sync",
    "recurrence": " by recurrence",
    "rule": " by workflow rule",
    "duplicate": " by cycle duplication",
}


class AgentKeyError(Exception):
    """Raised when assigned_agent_key_id refers to a missing or inactive key."""


def validate_agent_key(db: Session, key_id: str) -> ApiKey:
    """Return the active ApiKey for key_id or raise AgentKeyError."""
    key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not key:
        raise AgentKeyError("Agent API key not found")
    if not key.active:
        raise AgentKeyError("Agent API key is inactive")
    return key


async def _fire_status_events(
    db: Session,
    task: "graph.TaskView",
    new_status: str,
    project_id: str | None,
    *,
    source: str,
    actor: str | None,
) -> None:
    """Fire the status-change notification pair, plus project.complete when applicable."""
    await fire_notifications(db, task, "task.status_changed", source=source, actor=actor)
    await fire_notifications(db, task, f"task.{new_status}", source=source, actor=actor)
    if new_status == "done" and project_id is not None:
        project_tasks = graph.tasks_in_project(db, project_id)
        if project_tasks and all(t.status == "done" for t in project_tasks):
            await fire_notifications(db, task, "project.complete", source=source, actor=actor)


async def apply_task_update(
    db: Session,
    task_id: str,
    changes: dict,
    *,
    actor: str | None = None,
    source: str = "web",
    project_id: str | None = None,
    activity_meta: dict | None = None,
    trigger_rules: bool = True,
    sync_external: bool = True,
    commit: bool = True,
    broadcast: bool = True,
) -> "graph.TaskView":
    """Apply field changes to a task and run the full post-mutation pipeline.

    ``changes`` must not contain ``parent_id`` — re-parenting is a graph move
    handled by the caller (ADR-0032). When ``commit`` is False the caller owns
    the final commit; notifications and rules still run on flushed state.
    ``sync_external=False`` is for changes that originated externally
    (webhook callbacks) to avoid echo loops. ``trigger_rules=False`` is for changes a
    rule itself made: they still notify and log, but must not trigger another rule
    (ADR-0048).
    """
    task = graph.get_task(db, task_id)
    if task is None:
        raise ValueError(f"Task {task_id} not found")
    if project_id is None:
        project_id = graph.project_id_of_task(db, task_id)
    suffix = _SOURCE_SUFFIX.get(source, "")

    validated_agent: ApiKey | None = None
    if changes.get("assigned_agent_key_id") is not None:
        validated_agent = validate_agent_key(db, changes["assigned_agent_key_id"])

    old_status = task.status
    old_priority = task.priority
    old_assignee = task.assignee
    old_agent_key_id = task.assigned_agent_key_id
    old_title = task.title
    old_description = task.description
    old_due_date = task.due_date

    if changes:
        task = graph.update_task(db, task_id, **changes)

    triggered_rules: list[tuple[str, dict]] = []
    status_changed = "status" in changes and changes["status"] != old_status

    if status_changed:
        log_activity(
            db,
            "task.status_changed",
            project_id=project_id,
            task_id=task_id,
            actor=actor or task.assignee,
            detail=f'Task "{task.title}" changed from {old_status} to {changes["status"]}{suffix}',
            meta={"old_status": old_status, "new_status": changes["status"], **(activity_meta or {})},
        )
        triggered_rules.append(("task.status_changed", {"old_status": old_status}))

    if "priority" in changes and changes["priority"] != old_priority:
        triggered_rules.append(("task.priority_changed", {"old_priority": old_priority}))

    if "assignee" in changes and changes["assignee"] != old_assignee:
        log_activity(
            db,
            "task.assigned",
            project_id=project_id,
            task_id=task_id,
            actor=actor or changes["assignee"],
            detail=f'Task "{task.title}" assigned to {changes["assignee"] or "unassigned"}{suffix}',
            meta={"old_assignee": old_assignee, "new_assignee": changes["assignee"], **(activity_meta or {})},
        )

    if "assigned_agent_key_id" in changes and changes["assigned_agent_key_id"] != old_agent_key_id:
        agent_name = validated_agent.name if validated_agent else None
        log_activity(
            db,
            "task.agent_assigned",
            project_id=project_id,
            task_id=task_id,
            actor=actor or agent_name or "system",
            detail=f'Task "{task.title}" agent assignment changed to {agent_name or "none"}{suffix}',
            meta={"agent_name": agent_name, **(activity_meta or {})},
        )

    if commit:
        db.commit()
    else:
        db.flush()
    task = graph.get_task(db, task_id)

    if status_changed:
        await _fire_status_events(db, task, changes["status"], project_id, source=source, actor=actor)
    if "assignee" in changes and changes["assignee"] != old_assignee:
        await fire_notifications(db, task, "task.assigned", source=source, actor=actor)

    if sync_external:
        # Deferred import: issue_sync lives in routers (imports this layer's
        # siblings at module load); same pattern as rules_engine._exec_action.
        from app.routers.issue_sync import (
            sync_task_closure_to_external,
            sync_task_fields_to_external,
            sync_task_reopen_to_external,
        )

        if status_changed:
            if changes["status"] == "done":
                await sync_task_closure_to_external(task, db)
            elif old_status == "done":
                await sync_task_reopen_to_external(task, db)

        if task.external_provider:
            changed_fields = set()
            if "title" in changes and changes["title"] != old_title:
                changed_fields.add("title")
            if "description" in changes and changes["description"] != old_description:
                changed_fields.add("description")
            if "assignee" in changes and changes["assignee"] != old_assignee:
                changed_fields.add("assignee")
            if "due_date" in changes and changes["due_date"] != old_due_date:
                changed_fields.add("due_date")
            if changed_fields:
                await sync_task_fields_to_external(task, db, changed_fields)

    if not trigger_rules:
        triggered_rules = []
    for trigger, ctx in triggered_rules:
        await run_rules(db, trigger, task, ctx)
    if triggered_rules:
        if commit:
            db.commit()
        task = graph.get_task(db, task_id)

    if broadcast:
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task_id})
    return task


async def finalize_task_create(
    db: Session,
    task_id: str,
    *,
    actor: str | None = None,
    source: str = "web",
    project_id: str | None,
    activity_meta: dict | None = None,
    commit: bool = True,
    broadcast: bool = True,
) -> "graph.TaskView":
    """Run the post-creation pipeline for a task already created via graph.create_task.

    Logs task.created, runs creation rules, fires notifications, and
    broadcasts. With ``commit=False``/``broadcast=False`` (bulk create loops)
    the caller commits once and emits its own aggregate event.
    """
    task = graph.get_task(db, task_id)
    if task is None:
        raise ValueError(f"Task {task_id} not found")
    # A task created via the generic /api/nodes surface may have no container yet
    # (ADR-0040): tolerate a null project rather than a NULL-PK lookup.
    project = graph.get_project(db, project_id) if project_id else None
    suffix = _SOURCE_SUFFIX.get(source, "")
    in_project = f" in {project.name}" if project else ""

    log_activity(
        db,
        "task.created",
        project_id=project_id,
        task_id=task_id,
        actor=actor or task.assignee,
        detail=f'Task "{task.title}" created{in_project}{suffix}',
        meta={"title": task.title, "priority": task.priority, **(activity_meta or {})},
    )
    if commit:
        db.commit()
    else:
        db.flush()
    task = graph.get_task(db, task_id)

    await run_rules(db, "task.created", task, {})
    if commit:
        db.commit()
    task = graph.get_task(db, task_id)

    await fire_notifications(db, task, "task.created", source=source, actor=actor)
    if broadcast:
        await ws_manager.broadcast("task.created", {"project_id": project_id, "task_id": task_id})
    return task
