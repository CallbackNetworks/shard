"""Tests for the LLM assistant tool dispatch and implementations."""

import json

import pytest

from app.models import ActivityLog, Label, Project, Task, TaskLabel
from app.services.assistant_tools import dispatch_tool


@pytest.fixture()
def project_with_tasks(db):
    p = Project(name="Test Project", status="active")
    db.add(p)
    db.flush()
    t1 = Task(project_id=p.id, title="Task Alpha", status="todo", priority="high", assignee="alice")
    t2 = Task(project_id=p.id, title="Task Beta", status="done", priority="low")
    db.add_all([t1, t2])
    db.flush()
    return p, t1, t2


# ── dispatch_tool routing ────────────────────────────────────────────────


class TestDispatchRouting:
    @pytest.mark.asyncio
    async def test_unknown_tool(self, db):
        result = await dispatch_tool("nonexistent", {}, db)
        assert "Unknown tool" in result

    @pytest.mark.asyncio
    async def test_tool_error_returns_message(self, db):
        result = await dispatch_tool("list_tasks", {}, db)  # missing required project_id
        assert "error" in result.lower() or "missing" in result.lower() or "project_id" in result.lower()


# ── get_summary ──────────────────────────────────────────────────────────


class TestGetSummary:
    @pytest.mark.asyncio
    async def test_returns_project_summary(self, db, project_with_tasks):
        result = await dispatch_tool("get_summary", {}, db)
        data = json.loads(result)
        assert len(data) >= 1
        proj = data[0]
        assert proj["name"] == "Test Project"
        assert proj["total"] == 2
        assert proj["done"] == 1


# ── list_tasks ───────────────────────────────────────────────────────────


class TestListTasks:
    @pytest.mark.asyncio
    async def test_list_all_tasks(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("list_tasks", {"project_id": p.id}, db)
        data = json.loads(result)
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_list_tasks_filter_status(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("list_tasks", {"project_id": p.id, "status": "todo"}, db)
        data = json.loads(result)
        assert len(data) == 1
        assert data[0]["status"] == "todo"


# ── create_task ──────────────────────────────────────────────────────────


class TestCreateTask:
    @pytest.mark.asyncio
    async def test_creates_task(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool(
            "create_task",
            {
                "project_id": p.id,
                "title": "New Task",
                "priority": "medium",
            },
            db,
        )
        data = json.loads(result)
        assert data["title"] == "New Task"
        assert data["status"] == "todo"
        assert data["id"]

    @pytest.mark.asyncio
    async def test_create_task_nonexistent_project(self, db):
        result = await dispatch_tool(
            "create_task",
            {
                "project_id": "nonexistent",
                "title": "Orphan",
            },
            db,
        )
        assert "not found" in result


# ── update_task ──────────────────────────────────────────────────────────


class TestUpdateTask:
    @pytest.mark.asyncio
    async def test_update_status(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("update_task", {"task_id": t1.id, "status": "in_progress"}, db)
        data = json.loads(result)
        assert data["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_update_priority(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("update_task", {"task_id": t1.id, "priority": "low"}, db)
        data = json.loads(result)
        assert data["priority"] == "low"

    @pytest.mark.asyncio
    async def test_update_nonexistent_task(self, db):
        result = await dispatch_tool("update_task", {"task_id": "nonexistent", "status": "done"}, db)
        assert "not found" in result

    @pytest.mark.asyncio
    async def test_backward_compat_update_task_status(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool("update_task_status", {"task_id": t1.id, "status": "done"}, db)
        data = json.loads(result)
        assert data["status"] == "done"


# ── create_subtask ───────────────────────────────────────────────────────


class TestCreateSubtask:
    @pytest.mark.asyncio
    async def test_creates_subtask(self, db, project_with_tasks):
        _, t1, _ = project_with_tasks
        result = await dispatch_tool(
            "create_subtask",
            {
                "parent_task_id": t1.id,
                "title": "Sub-item",
            },
            db,
        )
        data = json.loads(result)
        assert data["title"] == "Sub-item"
        assert data["parent_id"] == t1.id

    @pytest.mark.asyncio
    async def test_subtask_nonexistent_parent(self, db):
        result = await dispatch_tool(
            "create_subtask",
            {
                "parent_task_id": "nonexistent",
                "title": "Orphan sub",
            },
            db,
        )
        assert "not found" in result


# ── manage_labels ────────────────────────────────────────────────────────


class TestManageLabels:
    @pytest.mark.asyncio
    async def test_list_labels(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        label = Label(project_id=p.id, name="bug", color="#ff0000")
        db.add(label)
        db.flush()

        result = await dispatch_tool("manage_labels", {"action": "list", "project_id": p.id}, db)
        data = json.loads(result)
        assert len(data) == 1
        assert data[0]["name"] == "bug"

    @pytest.mark.asyncio
    async def test_add_label_to_task(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        label = Label(project_id=p.id, name="urgent", color="#ff0000")
        db.add(label)
        db.flush()

        result = await dispatch_tool("manage_labels", {"action": "add", "task_id": t1.id, "label_id": label.id}, db)
        data = json.loads(result)
        assert data["status"] == "added"

    @pytest.mark.asyncio
    async def test_add_label_duplicate(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        label = Label(project_id=p.id, name="dup", color="#000")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=t1.id, label_id=label.id))
        db.flush()

        result = await dispatch_tool("manage_labels", {"action": "add", "task_id": t1.id, "label_id": label.id}, db)
        assert "already" in result.lower()

    @pytest.mark.asyncio
    async def test_remove_label(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        label = Label(project_id=p.id, name="old", color="#000")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=t1.id, label_id=label.id))
        db.flush()

        result = await dispatch_tool("manage_labels", {"action": "remove", "task_id": t1.id, "label_id": label.id}, db)
        data = json.loads(result)
        assert data["status"] == "removed"


# ── analyze_workload ─────────────────────────────────────────────────────


class TestAnalyzeWorkload:
    @pytest.mark.asyncio
    async def test_returns_breakdown(self, db, project_with_tasks):
        p, _, _ = project_with_tasks
        result = await dispatch_tool("analyze_workload", {"project_id": p.id}, db)
        data = json.loads(result)
        assert data["total_tasks"] == 2
        assert "by_status" in data
        assert "by_priority" in data
        assert "by_assignee" in data


# ── search ───────────────────────────────────────────────────────────────


class TestSearch:
    @pytest.mark.asyncio
    async def test_finds_tasks_by_title(self, db, project_with_tasks):
        result = await dispatch_tool("search", {"query": "Alpha"}, db)
        data = json.loads(result)
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["title"] == "Task Alpha"

    @pytest.mark.asyncio
    async def test_finds_projects_by_name(self, db, project_with_tasks):
        result = await dispatch_tool("search", {"query": "Test"}, db)
        data = json.loads(result)
        assert len(data["projects"]) >= 1


# ── get_activity ─────────────────────────────────────────────────────────


class TestGetActivity:
    @pytest.mark.asyncio
    async def test_returns_activity_entries(self, db, project_with_tasks):
        p, t1, _ = project_with_tasks
        entry = ActivityLog(project_id=p.id, task_id=t1.id, action="task.created", actor="test", detail="Created task")
        db.add(entry)
        db.flush()

        result = await dispatch_tool("get_activity", {"limit": 5}, db)
        data = json.loads(result)
        assert len(data) >= 1
        assert data[0]["action"] == "task.created"
