"""Tests for the workflow rules engine."""

import re
from pathlib import Path

import pytest

from app.models import ActivityLog, Comment, Node, NodeType, WorkflowRule
from app.services import graph, rules_engine, task_mutations
from app.services.rules_engine import _eval_condition, _exec_action, run_rules
from tests.factories import make_project, make_task

# ── _eval_condition ──────────────────────────────────────────────────────


class TestEvalCondition:
    @pytest.fixture()
    def task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        t = make_task(
            db, project_id=project.id, title="Fix login bug", status="todo", priority="high", assignee="alice"
        )
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
        label = graph.create_label(db, graph.project_id_of_task(db, task.id), name="bug", color="#ff0000")
        graph.set_label(db, task.id, label.id)
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
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        t = make_task(db, project_id=project.id, title="Task A", status="todo", priority="low")
        db.add(t)
        db.flush()
        return project, t

    # _exec_action returns the task, refreshed when the action changed it: field writes
    # go through apply_task_update, which rebuilds the TaskView, so the view handed in is
    # stale afterwards (ADR-0048).

    @pytest.mark.asyncio
    async def test_set_status(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_status", "value": "done"}, task)
        assert task.status == "done"

    @pytest.mark.asyncio
    async def test_set_status_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_status", "value": "invalid"}, task)
        assert task.status == "todo"

    @pytest.mark.asyncio
    async def test_set_priority(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_priority", "value": "high"}, task)
        assert task.priority == "high"

    @pytest.mark.asyncio
    async def test_set_priority_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_priority", "value": "critical"}, task)
        assert task.priority == "low"

    @pytest.mark.asyncio
    async def test_set_assignee(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_assignee", "value": "bob"}, task)
        assert task.assignee == "bob"

    @pytest.mark.asyncio
    async def test_set_assignee_empty_clears(self, db, project_and_task):
        _, task = project_and_task
        task = await _exec_action(db, {"type": "set_assignee", "value": "alice"}, task)
        task = await _exec_action(db, {"type": "set_assignee", "value": ""}, task)
        assert task.assignee is None

    @pytest.mark.asyncio
    async def test_add_label(self, db, project_and_task):
        project, task = project_and_task
        label = graph.create_label(db, project.id, name="urgent", color="#ff0000")

        await _exec_action(db, {"type": "add_label", "value": label.id}, task)
        db.flush()

        assert label.id in graph.label_ids_for_task(db, task.id)

    @pytest.mark.asyncio
    async def test_add_label_no_duplicate(self, db, project_and_task):
        project, task = project_and_task
        label = graph.create_label(db, project.id, name="urgent", color="#ff0000")
        graph.set_label(db, task.id, label.id)
        db.flush()

        await _exec_action(db, {"type": "add_label", "value": label.id}, task)
        db.flush()

        assert graph.label_ids_for_task(db, task.id).count(label.id) == 1

    @pytest.mark.asyncio
    async def test_remove_label(self, db, project_and_task):
        project, task = project_and_task
        label = graph.create_label(db, project.id, name="old", color="#aaa")
        graph.set_label(db, task.id, label.id)
        db.flush()

        await _exec_action(db, {"type": "remove_label", "value": label.id}, task)
        db.flush()

        assert label.id not in graph.label_ids_for_task(db, task.id)

    @pytest.mark.asyncio
    async def test_add_comment(self, db, project_and_task):
        _, task = project_and_task
        await _exec_action(db, {"type": "add_comment", "value": "Auto-comment from rule"}, task)
        db.flush()

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is not None
        assert c.body == "Auto-comment from rule"
        assert c.author == "workflow"


# ── run_rules ────────────────────────────────────────────────────────────


class TestRunRules:
    @pytest.fixture()
    def setup(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="Deploy app", status="done", priority="high")
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
        other = make_project(db, name="Other")
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
    async def test_rules_do_not_chain(self, db, setup):
        """Rule A's change must not trigger rule B (ADR-0048).

        Rule actions now run through the task pipeline, so they produce the same events a
        human-made change produces — which is precisely what would let two rules ping-pong.
        The pipeline is called with ``trigger_rules=False`` to cut it off at the source.
        """
        project, task = setup
        db.add(
            WorkflowRule(
                name="A: start work",
                trigger="task.created",
                conditions=[],
                actions=[{"type": "set_status", "value": "in_progress"}],
                active=True,
                run_count=0,
            )
        )
        chained = WorkflowRule(
            name="B: reacts to status changes",
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(chained)
        db.flush()

        await run_rules(db, "task.created", task, {})

        assert graph.get_task(db, task.id).status == "in_progress"  # A ran
        db.refresh(chained)
        assert chained.run_count == 0  # B did not
        assert graph.get_task(db, task.id).priority == "high"

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
        assert graph.get_task(db, task.id).assignee == "bot"


class TestLabelActionsAcceptNames:
    """Rules are usually global, so a label id pins the action to one project."""

    @pytest.fixture
    def project_and_task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T")
        db.add(task)
        db.flush()
        return project, graph.get_task(db, task.id)

    @pytest.mark.asyncio
    async def test_add_label_by_name(self, db, project_and_task):
        project, task = project_and_task
        label = graph.create_label(db, project.id, name="urgent", color="#ff0000")

        await _exec_action(db, {"type": "add_label", "value": "urgent"}, task)
        db.flush()

        assert label.id in graph.label_ids_for_task(db, task.id)

    @pytest.mark.asyncio
    async def test_remove_label_by_name(self, db, project_and_task):
        project, task = project_and_task
        label = graph.create_label(db, project.id, name="stale", color="#aaa")
        graph.set_label(db, task.id, label.id)
        db.flush()

        await _exec_action(db, {"type": "remove_label", "value": "stale"}, task)
        db.flush()

        assert label.id not in graph.label_ids_for_task(db, task.id)

    @pytest.mark.asyncio
    async def test_unknown_label_is_a_no_op(self, db, project_and_task):
        _, task = project_and_task
        await _exec_action(db, {"type": "add_label", "value": "nope"}, task)
        db.flush()

        assert graph.label_ids_for_task(db, task.id) == []


class TestVocabularyMatchesTheEngine:
    """The schema layer rejects anything outside these sets, so a set that drifts
    away from the engine's branches would either block a working value or let a
    dead one through. Scanned from source because the branches are if/elif chains
    with no runtime registry to inspect."""

    @pytest.fixture
    def source(self):
        return Path(rules_engine.__file__).read_text()

    def _handled(self, source: str, variable: str) -> set[str]:
        """Values the engine branches on, whether the branch is ``== "x"`` or ``in (...)``."""
        handled = set(re.findall(rf'\b{variable} == "([^"]+)"', source))
        for group in re.findall(rf"\b{variable} in \(([^)]*)\)", source):
            handled.update(re.findall(r'"([^"]+)"', group))
        return handled

    def test_condition_fields(self, source):
        assert self._handled(source, "field") == rules_engine.CONDITION_FIELDS

    def test_condition_ops(self, source):
        assert self._handled(source, "op") == rules_engine.CONDITION_OPS

    def test_action_types(self, source):
        assert self._handled(source, "atype") == rules_engine.ACTION_TYPES


class TestRuleChangesAreVisible:
    """A rule-made change earns the same activity entry and notifications a person's does.

    Before ADR-0048 the actions wrote fields straight through ``graph.update_task``, so a
    rule flipping a task to done produced no ``task.done``, no ``task.status_changed``,
    and no status-change activity entry — only a ``rule.executed`` line. The automation
    was invisible to exactly the integrations it was supposed to drive.
    """

    @pytest.fixture()
    def setup(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T", status="todo", priority="high")
        db.add(task)
        db.flush()
        return project, graph.get_task(db, task.id)

    @staticmethod
    def _rule(db, actions):
        rule = WorkflowRule(
            name="R", trigger="task.status_changed", conditions=[], actions=actions, active=True, run_count=0
        )
        db.add(rule)
        db.flush()
        return rule

    @pytest.mark.asyncio
    async def test_status_action_fires_the_status_events(self, db, setup, monkeypatch):
        _, task = setup
        self._rule(db, [{"type": "set_status", "value": "done"}])
        fired = []

        async def fake_fire(db_, task_, event, **kwargs):
            fired.append((event, kwargs.get("source")))

        monkeypatch.setattr(task_mutations, "fire_notifications", fake_fire)
        await run_rules(db, "task.status_changed", task, {})

        assert ("task.status_changed", "rule") in fired
        assert ("task.done", "rule") in fired

    @pytest.mark.asyncio
    async def test_status_action_logs_the_change(self, db, setup):
        project, task = setup
        self._rule(db, [{"type": "set_status", "value": "done"}])

        await run_rules(db, "task.status_changed", task, {})

        actions = [a.action for a in db.query(ActivityLog).filter(ActivityLog.task_id == task.id).all()]
        assert "task.status_changed" in actions
        assert "rule.executed" in actions

    @pytest.mark.asyncio
    async def test_rule_changes_are_not_synced_to_external_trackers(self, db, setup, monkeypatch):
        """A rule's change must not be pushed to the provider it may have come from (ADR-0014)."""
        _, task = setup
        self._rule(db, [{"type": "set_status", "value": "done"}])
        called = []
        monkeypatch.setattr(
            "app.routers.issue_sync.sync_task_closure_to_external",
            lambda *a, **k: called.append(True),
        )

        await run_rules(db, "task.status_changed", task, {})

        assert called == []


class TestRulesSeeEveryNode:
    """``node.created`` fires for every node type, not only task-role ones (ADR-0049).

    Before this, a user could define a ``decision`` type and have no way at all to say
    "when a decision is created, tell my external system": non-task nodes never reached
    the engine, and the conditions could not read a node's type or roles.
    """

    @pytest.fixture()
    def decision(self, db):
        """A node with no task role, inside a project."""
        db.add(NodeType(key="decision", label="Decision", is_builtin=False, roles=[]))
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        node = Node(type="decision", title="Adopt the graph model", status="todo")
        db.add(node)
        db.flush()
        graph.add_edge(db, project.id, node.id, graph.REL_CONTAINS)
        db.flush()
        return project, node

    @staticmethod
    def _rule(db, *, conditions, actions):
        rule = WorkflowRule(
            name="R", trigger="node.created", conditions=conditions, actions=actions, active=True, run_count=0
        )
        db.add(rule)
        db.flush()
        return rule

    @pytest.mark.asyncio
    async def test_a_rule_runs_on_a_non_task_node(self, db, decision):
        _, node = decision
        rule = self._rule(db, conditions=[], actions=[{"type": "fire_event", "value": "decision.made"}])

        await run_rules(db, "node.created", node, {})

        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_type_condition_narrows_to_one_type(self, db, decision):
        _, node = decision
        matching = self._rule(
            db,
            conditions=[{"field": "type", "op": "eq", "value": "decision"}],
            actions=[{"type": "fire_event", "value": "decision.made"}],
        )
        other = self._rule(
            db,
            conditions=[{"field": "type", "op": "eq", "value": "task"}],
            actions=[{"type": "fire_event", "value": "nope"}],
        )

        await run_rules(db, "node.created", node, {})

        db.refresh(matching)
        db.refresh(other)
        assert (matching.run_count, other.run_count) == (1, 0)

    @pytest.mark.asyncio
    async def test_has_role_condition_is_how_a_rule_stays_task_only(self, db, decision):
        """The shape the Alembic migration rewrites every old ``task.created`` rule into."""
        _, node = decision
        rule = self._rule(
            db,
            conditions=[{"field": "has_role", "op": "eq", "value": "task"}],
            actions=[{"type": "fire_event", "value": "nope"}],
        )

        await run_rules(db, "node.created", node, {})
        db.refresh(rule)
        assert rule.run_count == 0

        task = make_task(db, project_id=decision[0].id, title="T", status="todo")
        db.add(task)
        db.flush()
        await run_rules(db, "node.created", graph.get_task(db, task.id), {})
        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_a_task_only_action_is_skipped_visibly(self, db, decision):
        """Not a silent no-op: the activity feed says which action and why (ADR-0049)."""
        _, node = decision
        self._rule(db, conditions=[], actions=[{"type": "add_comment", "value": "hi"}])

        await run_rules(db, "node.created", node, {})

        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").all()
        assert len(skipped) == 1
        assert skipped[0].meta["action"] == "add_comment"
        assert skipped[0].meta["node_id"] == node.id
        assert db.query(Comment).count() == 0

    @pytest.mark.asyncio
    async def test_fire_event_is_scoped_to_the_nearest_container(self, db, decision):
        project, node = decision
        assert graph.container_of_node(db, node.id).id == project.id

    @pytest.mark.asyncio
    async def test_a_node_with_no_container_has_no_project_scope(self, db):
        db.add(NodeType(key="decision", label="Decision", is_builtin=False, roles=[]))
        node = Node(type="decision", title="Orphan", status="todo")
        db.add(node)
        db.flush()

        assert graph.container_of_node(db, node.id) is None
