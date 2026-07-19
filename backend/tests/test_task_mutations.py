"""Unit tests for the unified task mutation pipeline (ADR-0038)."""

import pytest

from app.models import ActivityLog, ApiKey
from app.services import graph, task_mutations
from app.services.task_mutations import (
    AgentKeyError,
    apply_task_update,
    finalize_task_create,
    validate_agent_key,
)
from tests.factories import make_task


@pytest.fixture()
def task(db, sample_project):
    node = make_task(db, project_id=sample_project.id, title="Pipeline task", status="todo", priority="medium")
    db.commit()
    return graph.get_task(db, node.id)


@pytest.fixture()
def capture(monkeypatch):
    """Capture notification events and ws broadcasts; silence external sync."""
    events: dict = {"notifications": [], "broadcasts": [], "synced": []}

    async def fake_notify(db, task, event):
        events["notifications"].append(event)

    async def fake_broadcast(event, data=None):
        events["broadcasts"].append((event, data))

    async def fake_sync(*args, **kwargs):
        events["synced"].append(args)
        return True

    monkeypatch.setattr(task_mutations, "fire_notifications", fake_notify)
    monkeypatch.setattr(task_mutations.ws_manager, "broadcast", fake_broadcast)
    import app.routers.issue_sync as issue_sync

    monkeypatch.setattr(issue_sync, "sync_task_closure_to_external", fake_sync)
    monkeypatch.setattr(issue_sync, "sync_task_reopen_to_external", fake_sync)
    monkeypatch.setattr(issue_sync, "sync_task_fields_to_external", fake_sync)
    return events


@pytest.mark.asyncio
async def test_status_change_fires_both_events_and_logs(db, sample_project, task, capture):
    result = await apply_task_update(db, task.id, {"status": "in_progress"}, actor="tester", source="api")
    assert result.status == "in_progress"
    assert "task.status_changed" in capture["notifications"]
    assert "task.in_progress" in capture["notifications"]
    rows = db.query(ActivityLog).filter(ActivityLog.action == "task.status_changed").all()
    assert len(rows) == 1
    assert rows[0].actor == "tester"
    assert "via API" in rows[0].detail
    assert rows[0].meta["old_status"] == "todo"
    assert capture["broadcasts"] == [("task.updated", {"project_id": sample_project.id, "task_id": task.id})]


@pytest.mark.asyncio
async def test_done_fires_project_complete_when_all_done(db, sample_project, task, capture):
    await apply_task_update(db, task.id, {"status": "done"}, source="web")
    assert "task.done" in capture["notifications"]
    assert "project.complete" in capture["notifications"]


@pytest.mark.asyncio
async def test_no_project_complete_while_siblings_open(db, sample_project, task, capture):
    make_task(db, project_id=sample_project.id, title="Still open", status="todo")
    db.commit()
    await apply_task_update(db, task.id, {"status": "done"})
    assert "task.done" in capture["notifications"]
    assert "project.complete" not in capture["notifications"]


@pytest.mark.asyncio
async def test_assignee_change_logs_and_notifies(db, task, capture):
    await apply_task_update(db, task.id, {"assignee": "alice"})
    assert "task.assigned" in capture["notifications"]
    row = db.query(ActivityLog).filter(ActivityLog.action == "task.assigned").one()
    assert row.meta["new_assignee"] == "alice"


@pytest.mark.asyncio
async def test_unchanged_fields_fire_nothing(db, task, capture):
    await apply_task_update(db, task.id, {"status": "todo", "title": "Renamed"})
    assert capture["notifications"] == []
    assert db.query(ActivityLog).count() == 0


@pytest.mark.asyncio
async def test_invalid_agent_key_raises(db, task, capture):
    with pytest.raises(AgentKeyError, match="not found"):
        await apply_task_update(db, task.id, {"assigned_agent_key_id": "nope"})


def test_validate_agent_key_inactive(db):
    key = ApiKey(name="dead-key", key_hash="x", active=False)
    db.add(key)
    db.commit()
    with pytest.raises(AgentKeyError, match="inactive"):
        validate_agent_key(db, key.id)


@pytest.mark.asyncio
async def test_commit_false_defers_commit(db, task, capture, monkeypatch):
    committed = []
    monkeypatch.setattr(db, "commit", lambda: committed.append(True))
    await apply_task_update(db, task.id, {"status": "in_progress"}, commit=False)
    assert committed == []
    # Flushed state is still visible in-session.
    assert graph.get_task(db, task.id).status == "in_progress"


@pytest.mark.asyncio
async def test_broadcast_false_suppresses_ws(db, task, capture):
    await apply_task_update(db, task.id, {"status": "in_progress"}, broadcast=False)
    assert capture["broadcasts"] == []
    assert "task.status_changed" in capture["notifications"]


@pytest.mark.asyncio
async def test_external_sync_gated_by_flag(db, sample_project, task, capture):
    graph.update_task(db, task.id, external_provider="github", external_id="42")
    db.commit()
    await apply_task_update(db, task.id, {"status": "done"}, sync_external=False)
    assert capture["synced"] == []
    await apply_task_update(db, task.id, {"status": "todo"}, sync_external=True)
    assert capture["synced"] != []  # reopen sync called


@pytest.mark.asyncio
async def test_field_change_syncs_to_external(db, task, capture):
    graph.update_task(db, task.id, external_provider="github", external_id="42")
    db.commit()
    await apply_task_update(db, task.id, {"title": "New title"})
    assert len(capture["synced"]) == 1


@pytest.mark.asyncio
async def test_rules_run_with_depth(db, task, capture, monkeypatch):
    seen = []

    async def fake_rules(db_, trigger, task_, context):
        seen.append((trigger, context.get("_rule_depth")))

    monkeypatch.setattr(task_mutations, "run_rules", fake_rules)
    await apply_task_update(db, task.id, {"status": "in_progress", "priority": "high"}, rule_depth=1)
    assert ("task.status_changed", 1) in seen
    assert ("task.priority_changed", 1) in seen


@pytest.mark.asyncio
async def test_finalize_task_create_pipeline(db, sample_project, capture):
    view = graph.create_task(db, project_id=sample_project.id, title="Fresh task")
    result = await finalize_task_create(db, view.id, actor="api-bot", source="api", project_id=sample_project.id)
    assert result.id == view.id
    row = db.query(ActivityLog).filter(ActivityLog.action == "task.created").one()
    assert row.actor == "api-bot"
    assert "via API" in row.detail
    assert "task.created" in capture["notifications"]
    assert capture["broadcasts"] == [("task.created", {"project_id": sample_project.id, "task_id": view.id})]


@pytest.mark.asyncio
async def test_finalize_create_bulk_mode(db, sample_project, capture):
    view = graph.create_task(db, project_id=sample_project.id, title="Bulk child")
    await finalize_task_create(db, view.id, project_id=sample_project.id, commit=False, broadcast=False)
    assert capture["broadcasts"] == []
    assert db.query(ActivityLog).filter(ActivityLog.action == "task.created").count() == 1


@pytest.mark.asyncio
async def test_missing_task_raises_value_error(db, capture):
    with pytest.raises(ValueError):
        await apply_task_update(db, "no-such-id", {"status": "done"})
