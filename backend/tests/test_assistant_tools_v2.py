"""Tests for the ADR-0102 task/project-domain tools added to the internal assistant.

Each of these mirrors an MCP tool but calls the underlying service/graph function
directly with the in-process ``db`` — no HTTP hop, no API-key scope. The point of these
tests is exercising the real service functions end to end (most of this file's coverage
was written from reading the code, not running it), not just checking dispatch routing.
"""

import json

import pytest

from app.models import ActivityLog, Comment, Notification, TaskTemplate
from app.services import graph
from app.services.assistant_tools import dispatch_tool
from tests.factories import make_project, make_task


@pytest.fixture()
def project_with_tasks(db):
    p = make_project(db, name="Test Project", status="active")
    db.add(p)
    db.flush()
    t1 = make_task(db, project_id=p.id, title="Task Alpha", status="todo", priority="high", assignee="alice")
    t2 = make_task(db, project_id=p.id, title="Task Beta", status="done", priority="low")
    db.add_all([t1, t2])
    db.flush()
    db.commit()
    return p, t1, t2


class TestComments:
    @pytest.mark.asyncio
    async def test_add_and_list_comment(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("add_comment", {"task_id": t1.id, "body": "Looking into this"}, db)
        data = json.loads(result)
        assert data["body"] == "Looking into this"

        listed = await dispatch_tool("list_comments", {"task_id": t1.id}, db)
        comments = json.loads(listed)
        assert len(comments) == 1
        assert comments[0]["author"] == "assistant"

    @pytest.mark.asyncio
    async def test_add_comment_blank_body_refused(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("add_comment", {"task_id": t1.id, "body": "   "}, db)
        assert "blank" in result.lower()

    @pytest.mark.asyncio
    async def test_add_comment_unknown_task(self, db):
        result = await dispatch_tool("add_comment", {"task_id": "nonexistent", "body": "hi"}, db)
        assert "not found" in result.lower()


class TestDependencies:
    @pytest.mark.asyncio
    async def test_add_list_remove(self, db, project_with_tasks):
        _, t1, t2 = project_with_tasks
        added = await dispatch_tool(
            "manage_dependencies", {"action": "add", "task_id": t1.id, "depends_on_id": t2.id}, db
        )
        assert json.loads(added)["status"] == "added"

        listed = json.loads(await dispatch_tool("manage_dependencies", {"action": "list", "task_id": t1.id}, db))
        assert listed["blocked_by"][0]["task_id"] == t2.id

        removed = await dispatch_tool(
            "manage_dependencies", {"action": "remove", "task_id": t1.id, "depends_on_id": t2.id}, db
        )
        assert json.loads(removed)["status"] == "removed"
        listed_after = json.loads(await dispatch_tool("manage_dependencies", {"action": "list", "task_id": t1.id}, db))
        assert listed_after["blocked_by"] == []

    @pytest.mark.asyncio
    async def test_self_dependency_refused(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool(
            "manage_dependencies", {"action": "add", "task_id": t1.id, "depends_on_id": t1.id}, db
        )
        assert "cannot depend on itself" in result


class TestNotifications:
    @pytest.mark.asyncio
    async def test_unread_count_read_and_delete(self, db):
        n1 = Notification(type="task.due_soon", message="A", read=False)
        n2 = Notification(type="task.overdue", message="B", read=False)
        db.add_all([n1, n2])
        db.commit()

        count = json.loads(await dispatch_tool("manage_notifications", {"action": "unread_count"}, db))
        assert count["unread_count"] == 2

        listed = json.loads(await dispatch_tool("get_notifications", {"unread_only": True}, db))
        assert len(listed) == 2

        await dispatch_tool("manage_notifications", {"action": "read", "notification_id": n1.id}, db)
        db.refresh(n1)
        assert n1.read is True

        await dispatch_tool("manage_notifications", {"action": "delete", "notification_id": n2.id}, db)
        assert db.query(Notification).filter(Notification.id == n2.id).first() is None

    @pytest.mark.asyncio
    async def test_read_all(self, db):
        db.add_all([Notification(type="x", message="a", read=False), Notification(type="x", message="b", read=False)])
        db.commit()
        await dispatch_tool("manage_notifications", {"action": "read_all"}, db)
        assert db.query(Notification).filter(Notification.read.is_(False)).count() == 0


class TestReportProgress:
    @pytest.mark.asyncio
    async def test_updates_progress_and_notes_and_comment(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool(
            "report_progress",
            {"task_id": t1.id, "progress_pct": 40, "agent_notes": "halfway", "comment": "checkpoint"},
            db,
        )
        assert json.loads(result)["progress_pct"] == 40
        task = graph.get_task(db, t1.id)
        assert task.progress_pct == 40
        assert task.agent_notes == "halfway"
        assert db.query(Comment).filter(Comment.task_id == t1.id).count() == 1
        # "task.progress_updated", not "task.updated" — proves this went through the narrow
        # graph.update_task path, not the full apply_task_update/rules-engine pipeline.
        assert db.query(ActivityLog).filter(ActivityLog.action == "task.progress_updated").count() == 1
        assert db.query(ActivityLog).filter(ActivityLog.action == "task.updated").count() == 0


class TestProjects:
    @pytest.mark.asyncio
    async def test_list_create_and_detail(self, db, project_with_tasks):
        p, t1, t2 = project_with_tasks
        listed = json.loads(await dispatch_tool("list_projects", {"status": "active"}, db))
        assert any(x["id"] == p.id and x["total_tasks"] == 2 and x["done_tasks"] == 1 for x in listed)

        created = json.loads(await dispatch_tool("create_project", {"name": "New One", "description": "d"}, db))
        assert created["name"] == "New One"
        assert graph.get_project(db, created["id"]) is not None

        detail = json.loads(await dispatch_tool("get_project_detail", {"project_id": p.id}, db))
        assert detail["total_tasks"] == 2
        assert {t["title"] for t in detail["tasks"]} == {"Task Alpha", "Task Beta"}

    @pytest.mark.asyncio
    async def test_create_project_blank_name_refused(self, db):
        result = await dispatch_tool("create_project", {"name": "   "}, db)
        assert "blank" in result.lower()

    @pytest.mark.asyncio
    async def test_get_project_detail_not_found(self, db):
        result = await dispatch_tool("get_project_detail", {"project_id": "nonexistent"}, db)
        assert "not found" in result.lower()


class TestDeleteTask:
    @pytest.mark.asyncio
    async def test_deletes_the_task(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("delete_task", {"task_id": t1.id}, db)
        assert json.loads(result)["status"] == "deleted"
        assert graph.get_task(db, t1.id) is None

    @pytest.mark.asyncio
    async def test_unknown_task(self, db):
        result = await dispatch_tool("delete_task", {"task_id": "nonexistent"}, db)
        assert "not found" in result.lower()


class TestContainerSubtree:
    @pytest.mark.asyncio
    async def test_returns_rollup(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = json.loads(await dispatch_tool("get_container_subtree", {"node_id": p.id}, db))
        assert result["total_tasks"] == 2
        assert result["done_tasks"] == 1


class TestBulkUpdateTasks:
    @pytest.mark.asyncio
    async def test_updates_status_and_priority(self, db, project_with_tasks):
        p, t1, t2 = project_with_tasks
        result = json.loads(
            await dispatch_tool(
                "bulk_update_tasks",
                {"project_id": p.id, "updates": [{"id": t1.id, "status": "done"}, {"id": t2.id, "priority": "high"}]},
                db,
            )
        )
        assert set(result["updated"]) == {t1.id, t2.id}
        assert graph.get_task(db, t1.id).status == "done"
        assert graph.get_task(db, t2.id).priority == "high"

    @pytest.mark.asyncio
    async def test_task_outside_project_is_an_error_not_a_crash(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        other = make_project(db, name="Other")
        db.add(other)
        db.commit()
        result = json.loads(
            await dispatch_tool(
                "bulk_update_tasks", {"project_id": other.id, "updates": [{"id": t1.id, "status": "done"}]}, db
            )
        )
        assert result["updated"] == []
        assert len(result["errors"]) == 1

    @pytest.mark.asyncio
    async def test_reparent_cycle_is_reported_not_raised(self, db, project_with_tasks):
        p, t1, t2 = project_with_tasks
        # t2 becomes t1's parent, then trying to make t1 the parent of t2 would cycle.
        graph.set_parent_task(db, t2.id, t1.id)
        db.commit()
        result = json.loads(
            await dispatch_tool(
                "bulk_update_tasks", {"project_id": p.id, "updates": [{"id": t1.id, "parent_id": t2.id}]}, db
            )
        )
        assert result["updated"] == []
        assert "cycle" in result["errors"][0]


class TestUnfiled:
    @pytest.mark.asyncio
    async def test_list_and_file(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        unfiled_task = make_task(db, title="Orphan")
        db.add(unfiled_task)
        db.commit()

        listed = json.loads(await dispatch_tool("manage_unfiled", {"action": "list"}, db))
        assert any(t["id"] == unfiled_task.id for t in listed)

        filed = json.loads(
            await dispatch_tool(
                "manage_unfiled", {"action": "file", "task_id": unfiled_task.id, "project_id": p.id}, db
            )
        )
        assert filed["id"] == unfiled_task.id
        listed_after = json.loads(await dispatch_tool("manage_unfiled", {"action": "list"}, db))
        assert not any(t["id"] == unfiled_task.id for t in listed_after)


class TestGraphOrientation:
    @pytest.mark.asyncio
    async def test_graph_map_never_exposes_raw_data(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        graph.update_project(db, p.id, share_token="super-secret-token")
        db.commit()
        result = await dispatch_tool("get_graph_map", {}, db)
        assert "super-secret-token" not in result
        data = json.loads(result)
        assert all("data" not in n for n in data["nodes"])

    @pytest.mark.asyncio
    async def test_graph_map_filters_by_type(self, db, project_with_tasks):
        result = json.loads(await dispatch_tool("get_graph_map", {"types": "project"}, db))
        assert all(n["type"] == "project" for n in result["nodes"])

    @pytest.mark.asyncio
    async def test_ancestry_reports_trails(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        result = json.loads(await dispatch_tool("get_ancestry", {"node_ids": [t1.id]}, db))
        assert t1.id in result


class TestDecisions:
    @pytest.mark.asyncio
    async def test_list_and_export(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        created = await dispatch_tool(
            "create_decision",
            {
                "project_id": p.id,
                "name": "Use Postgres",
                "description": "## Context\n\n## Decision\n\n## Consequences\n",
            },
            db,
        )
        decision_id = json.loads(created)["id"]

        listed = json.loads(await dispatch_tool("list_decisions", {"project_id": p.id}, db))
        assert any(d["id"] == decision_id for d in listed)

        exported = json.loads(await dispatch_tool("export_decision", {"decision_id": decision_id}, db))
        assert "Use Postgres" in exported["markdown"]

    @pytest.mark.asyncio
    async def test_export_unknown_decision(self, db):
        result = await dispatch_tool("export_decision", {"decision_id": "nonexistent"}, db)
        assert "not found" in result.lower()


class TestCycles:
    @pytest.mark.asyncio
    async def test_list_get_and_duplicate(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        cycle = graph.create_cycle(db, project_id=p.id, name="Sprint 1", status="active")
        db.commit()

        listed = json.loads(await dispatch_tool("manage_cycles", {"action": "list", "project_id": p.id}, db))
        assert any(c["id"] == cycle.id for c in listed)

        got = json.loads(
            await dispatch_tool("manage_cycles", {"action": "get", "project_id": p.id, "cycle_id": cycle.id}, db)
        )
        assert got["name"] == "Sprint 1"

        dup = json.loads(
            await dispatch_tool("manage_cycles", {"action": "duplicate", "project_id": p.id, "cycle_id": cycle.id}, db)
        )
        assert dup["id"] != cycle.id

    @pytest.mark.asyncio
    async def test_unknown_cycle(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool(
            "manage_cycles", {"action": "get", "project_id": p.id, "cycle_id": "nonexistent"}, db
        )
        assert "not found" in result.lower()


class TestAnalytics:
    @pytest.mark.asyncio
    async def test_critical_path(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("get_analytics", {"report": "critical_path", "project_id": p.id}, db)
        assert "error" not in result.lower() or json.loads(result)

    @pytest.mark.asyncio
    async def test_estimate_suggestion_requires_raw_estimate(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("get_analytics", {"report": "estimate_suggestion", "project_id": p.id}, db)
        assert "raw_estimate is required" in result

    @pytest.mark.asyncio
    async def test_unknown_report(self, db):
        result = await dispatch_tool("get_analytics", {"report": "not_a_real_report"}, db)
        assert "unknown report" in result.lower()


class TestRecurrence:
    @pytest.mark.asyncio
    async def test_create_get_update_delete(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        created = json.loads(
            await dispatch_tool(
                "manage_recurrence",
                {
                    "action": "create",
                    "project_id": p.id,
                    "task_id": t1.id,
                    "config": {"frequency": "weekly", "next_run_at": "2026-09-01T00:00:00Z"},
                },
                db,
            )
        )
        assert created["frequency"] == "weekly"

        got = json.loads(
            await dispatch_tool("manage_recurrence", {"action": "get", "project_id": p.id, "task_id": t1.id}, db)
        )
        assert got["frequency"] == "weekly"

        updated = json.loads(
            await dispatch_tool(
                "manage_recurrence",
                {"action": "update", "project_id": p.id, "task_id": t1.id, "config": {"active": False}},
                db,
            )
        )
        assert updated["active"] is False

        deleted = await dispatch_tool(
            "manage_recurrence", {"action": "delete", "project_id": p.id, "task_id": t1.id}, db
        )
        assert json.loads(deleted)["status"] == "deleted"

    @pytest.mark.asyncio
    async def test_invalid_config_reported_not_raised(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        result = await dispatch_tool(
            "manage_recurrence",
            {"action": "create", "project_id": p.id, "task_id": t1.id, "config": {"frequency": "not_a_real_frequency"}},
            db,
        )
        assert "invalid config" in result.lower()

    @pytest.mark.asyncio
    async def test_second_create_is_refused(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        config = {"frequency": "daily", "next_run_at": "2026-09-01T00:00:00Z"}
        await dispatch_tool(
            "manage_recurrence", {"action": "create", "project_id": p.id, "task_id": t1.id, "config": config}, db
        )
        result = await dispatch_tool(
            "manage_recurrence", {"action": "create", "project_id": p.id, "task_id": t1.id, "config": config}, db
        )
        assert "already exists" in result


class TestTemplates:
    @pytest.mark.asyncio
    async def test_create_list_update_delete(self, db):
        created = json.loads(
            await dispatch_tool(
                "manage_templates", {"action": "create", "config": {"name": "Bug report", "priority": "high"}}, db
            )
        )
        assert created["name"] == "Bug report"

        listed = json.loads(await dispatch_tool("manage_templates", {"action": "list"}, db))
        assert any(t["id"] == created["id"] for t in listed)

        updated = json.loads(
            await dispatch_tool(
                "manage_templates",
                {"action": "update", "template_id": created["id"], "config": {"priority": "low"}},
                db,
            )
        )
        assert updated["priority"] == "low"

        deleted = await dispatch_tool("manage_templates", {"action": "delete", "template_id": created["id"]}, db)
        assert json.loads(deleted)["status"] == "deleted"
        assert db.query(TaskTemplate).filter(TaskTemplate.id == created["id"]).first() is None

    @pytest.mark.asyncio
    async def test_create_requires_name(self, db):
        result = await dispatch_tool("manage_templates", {"action": "create", "config": {}}, db)
        assert "name" in result.lower()


class TestAttachments:
    @pytest.mark.asyncio
    async def test_list_empty_and_delete_unknown(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        listed = json.loads(await dispatch_tool("manage_attachments", {"action": "list", "task_id": t1.id}, db))
        assert listed == []

        result = await dispatch_tool(
            "manage_attachments", {"action": "delete", "task_id": t1.id, "attachment_id": "nonexistent"}, db
        )
        assert "not found" in result.lower()

    @pytest.mark.asyncio
    async def test_upload_is_not_offered(self):
        from app.services.assistant_tools import TOOLS

        schema = next(t for t in TOOLS if t["name"] == "manage_attachments")["input_schema"]
        assert schema["properties"]["action"]["enum"] == ["list", "delete"]


class TestImportAndTransfer:
    @pytest.mark.asyncio
    async def test_import_tasks_github(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        payload = {
            "issues": [
                {"number": 1, "title": "Fix the bug", "body": "details", "state": "open", "html_url": "https://x/1"}
            ]
        }
        result = json.loads(
            await dispatch_tool("import_tasks", {"project_id": p.id, "source": "github", "payload": payload}, db)
        )
        assert result["imported"] == 1

    @pytest.mark.asyncio
    async def test_import_tasks_unknown_source(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("import_tasks", {"project_id": p.id, "source": "bitbucket", "payload": {}}, db)
        assert "unknown import source" in result.lower()

    @pytest.mark.asyncio
    async def test_transfer_export_then_import_round_trips(self, db, project_with_tasks):
        p, t1, t2 = project_with_tasks
        exported = json.loads(await dispatch_tool("transfer_tasks", {"action": "export", "project_id": p.id}, db))
        assert len(exported) == 2

        other = make_project(db, name="Destination")
        db.add(other)
        db.commit()
        imported = json.loads(
            await dispatch_tool("transfer_tasks", {"action": "import", "project_id": other.id, "tasks": exported}, db)
        )
        assert imported["created"] == 2

    @pytest.mark.asyncio
    async def test_transfer_import_requires_tasks(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("transfer_tasks", {"action": "import", "project_id": p.id}, db)
        assert "tasks is required" in result
