"""Tests for the workflow rules engine."""

import pytest

from app.models import Comment, Label, Project, Task, TaskLabel, WorkflowRule
from app.services.rules_engine import _eval_condition, _exec_action, run_rules

# ── _eval_condition ──────────────────────────────────────────────────────


class TestEvalCondition:
    @pytest.fixture()
    def task(self, db):
        project = Project(name="P")
        db.add(project)
        db.flush()
        t = Task(project_id=project.id, title="Fix login bug", status="todo", priority="high", assignee="alice")
        db.add(t)
        db.flush()
        return t

    def test_status_eq(self, db, task):
        assert _eval_condition({"field": "status", "op": "eq", "value": "todo"}, task, {}) is True
        assert _eval_condition({"field": "status", "op": "eq", "value": "done"}, task, {}) is False

    def test_status_neq(self, db, task):
        assert _eval_condition({"field": "status", "op": "neq", "value": "done"}, task, {}) is True
        assert _eval_condition({"field": "status", "op": "neq", "value": "todo"}, task, {}) is False

    def test_priority_eq(self, db, task):
        assert _eval_condition({"field": "priority", "op": "eq", "value": "high"}, task, {}) is True

    def test_priority_in(self, db, task):
        assert _eval_condition({"field": "priority", "op": "in", "value": ["high", "medium"]}, task, {}) is True
        assert _eval_condition({"field": "priority", "op": "in", "value": ["low"]}, task, {}) is False

    def test_assignee_eq(self, db, task):
        assert _eval_condition({"field": "assignee", "op": "eq", "value": "alice"}, task, {}) is True
        assert _eval_condition({"field": "assignee", "op": "eq", "value": "bob"}, task, {}) is False

    def test_assignee_empty_when_none(self, db, task):
        task.assignee = None
        assert _eval_condition({"field": "assignee", "op": "eq", "value": ""}, task, {}) is True

    def test_assignee_contains(self, db, task):
        assert _eval_condition({"field": "assignee", "op": "contains", "value": "ali"}, task, {}) is True

    def test_title_contains(self, db, task):
        assert _eval_condition({"field": "title_contains", "op": "eq", "value": "login"}, task, {}) is True
        assert _eval_condition({"field": "title_contains", "op": "eq", "value": "LOGIN"}, task, {}) is True
        assert _eval_condition({"field": "title_contains", "op": "eq", "value": "signup"}, task, {}) is False

    def test_title_not_contains(self, db, task):
        assert _eval_condition({"field": "title_contains", "op": "neq", "value": "signup"}, task, {}) is True
        assert _eval_condition({"field": "title_contains", "op": "neq", "value": "login"}, task, {}) is False

    def test_has_label(self, db, task):
        label = Label(project_id=task.project_id, name="bug", color="#ff0000")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=label.id))
        db.flush()
        db.refresh(task)
        assert _eval_condition({"field": "has_label", "value": "bug"}, task, {}) is True
        assert _eval_condition({"field": "has_label", "value": "feature"}, task, {}) is False

    def test_unknown_field_returns_false(self, db, task):
        assert _eval_condition({"field": "nonexistent", "op": "eq", "value": "x"}, task, {}) is False

    def test_unknown_op_returns_false(self, db, task):
        assert _eval_condition({"field": "status", "op": "gt", "value": "todo"}, task, {}) is False


# ── _exec_action ─────────────────────────────────────────────────────────


class TestExecAction:
    @pytest.fixture()
    def project_and_task(self, db):
        project = Project(name="P")
        db.add(project)
        db.flush()
        t = Task(project_id=project.id, title="Task A", status="todo", priority="low")
        db.add(t)
        db.flush()
        return project, t

    def test_set_status(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "set_status", "value": "done"}, task)
        assert task.status == "done"

    def test_set_status_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "set_status", "value": "invalid"}, task)
        assert task.status == "todo"

    def test_set_priority(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "set_priority", "value": "high"}, task)
        assert task.priority == "high"

    def test_set_priority_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "set_priority", "value": "critical"}, task)
        assert task.priority == "low"

    def test_set_assignee(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "set_assignee", "value": "bob"}, task)
        assert task.assignee == "bob"

    def test_set_assignee_empty_clears(self, db, project_and_task):
        _, task = project_and_task
        task.assignee = "alice"
        _exec_action(db, {"type": "set_assignee", "value": ""}, task)
        assert task.assignee is None

    def test_add_label(self, db, project_and_task):
        project, task = project_and_task
        label = Label(project_id=project.id, name="urgent", color="#ff0000")
        db.add(label)
        db.flush()

        _exec_action(db, {"type": "add_label", "value": label.id}, task)
        db.flush()

        tl = db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == label.id).first()
        assert tl is not None

    def test_add_label_no_duplicate(self, db, project_and_task):
        project, task = project_and_task
        label = Label(project_id=project.id, name="urgent", color="#ff0000")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=label.id))
        db.flush()

        _exec_action(db, {"type": "add_label", "value": label.id}, task)
        db.flush()

        count = db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == label.id).count()
        assert count == 1

    def test_remove_label(self, db, project_and_task):
        project, task = project_and_task
        label = Label(project_id=project.id, name="old", color="#aaa")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=label.id))
        db.flush()

        _exec_action(db, {"type": "remove_label", "value": label.id}, task)
        db.flush()

        tl = db.query(TaskLabel).filter(TaskLabel.task_id == task.id, TaskLabel.label_id == label.id).first()
        assert tl is None

    def test_add_comment(self, db, project_and_task):
        _, task = project_and_task
        _exec_action(db, {"type": "add_comment", "value": "Auto-comment from rule"}, task)
        db.flush()

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is not None
        assert c.body == "Auto-comment from rule"
        assert c.author == "workflow"


# ── run_rules ────────────────────────────────────────────────────────────


class TestRunRules:
    @pytest.fixture()
    def setup(self, db):
        project = Project(name="P")
        db.add(project)
        db.flush()
        task = Task(project_id=project.id, title="Deploy app", status="done", priority="high")
        db.add(task)
        db.flush()
        return project, task

    @pytest.mark.asyncio
    async def test_matching_rule_executes(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Auto high priority comment",
            trigger="task.status_changed",
            conditions=[{"field": "status", "op": "eq", "value": "done"}],
            actions=[{"type": "add_comment", "value": "Task completed!"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        db.flush()

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is not None
        assert c.body == "Task completed!"
        assert rule.run_count == 1
        assert rule.last_run_at is not None

    @pytest.mark.asyncio
    async def test_non_matching_condition_skips(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Only for todo",
            trigger="task.status_changed",
            conditions=[{"field": "status", "op": "eq", "value": "todo"}],
            actions=[{"type": "add_comment", "value": "Should not appear"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is None
        assert rule.run_count == 0

    @pytest.mark.asyncio
    async def test_inactive_rule_skipped(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Disabled rule",
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=False,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        assert task.priority == "high"

    @pytest.mark.asyncio
    async def test_wrong_trigger_skipped(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="On create only",
            trigger="task.created",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        assert task.priority == "high"

    @pytest.mark.asyncio
    async def test_project_scoped_rule_skips_other_project(self, db, setup):
        project, task = setup
        other = Project(name="Other")
        db.add(other)
        db.flush()

        rule = WorkflowRule(
            name="Scoped to other",
            project_id=other.id,
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        assert task.priority == "high"

    @pytest.mark.asyncio
    async def test_recursion_depth_guard(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Would recurse",
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {"_rule_depth": 2})
        assert task.priority == "high"  # action should NOT have executed

    @pytest.mark.asyncio
    async def test_multiple_conditions_and_logic(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Both conditions",
            trigger="task.status_changed",
            conditions=[
                {"field": "status", "op": "eq", "value": "done"},
                {"field": "priority", "op": "eq", "value": "high"},
            ],
            actions=[{"type": "add_comment", "value": "Both matched"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        db.flush()

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is not None
        assert c.body == "Both matched"

    @pytest.mark.asyncio
    async def test_multiple_conditions_partial_match_skips(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Partial match",
            trigger="task.status_changed",
            conditions=[
                {"field": "status", "op": "eq", "value": "done"},
                {"field": "priority", "op": "eq", "value": "low"},  # task is high
            ],
            actions=[{"type": "add_comment", "value": "Should not appear"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is None

    @pytest.mark.asyncio
    async def test_no_conditions_always_matches(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="No conditions",
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "set_assignee", "value": "bot"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "task.status_changed", task, {})
        assert task.assignee == "bot"
