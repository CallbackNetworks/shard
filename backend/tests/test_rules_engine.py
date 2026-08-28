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

    # _exec_action returns (task, outcome). The task is refreshed when the action changed
    # it: field writes go through apply_task_update, which rebuilds the TaskView, so the
    # view handed in is stale afterwards (ADR-0048). The outcome says what the action
    # actually did (ADR-0053).

    @pytest.mark.asyncio
    async def test_set_status(self, db, project_and_task):
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_status", "value": "done"}, task)
        assert task.status == "done"
        assert outcome["outcome"] == "applied"
        assert outcome["from"] == "todo"

    @pytest.mark.asyncio
    async def test_set_status_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_status", "value": "invalid"}, task)
        assert task.status == "todo"
        assert (outcome["outcome"], outcome["reason"]) == ("skipped", "invalid_value")

    @pytest.mark.asyncio
    async def test_set_priority(self, db, project_and_task):
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_priority", "value": "high"}, task)
        assert task.priority == "high"
        assert outcome["outcome"] == "applied"

    @pytest.mark.asyncio
    async def test_set_priority_invalid_ignored(self, db, project_and_task):
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_priority", "value": "critical"}, task)
        assert task.priority == "low"
        assert (outcome["outcome"], outcome["reason"]) == ("skipped", "invalid_value")

    @pytest.mark.asyncio
    async def test_set_assignee(self, db, project_and_task):
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_assignee", "value": "bob"}, task)
        assert task.assignee == "bob"
        assert outcome["outcome"] == "applied"

    @pytest.mark.asyncio
    async def test_set_assignee_empty_clears(self, db, project_and_task):
        _, task = project_and_task
        task, _ = await _exec_action(db, {"type": "set_assignee", "value": "alice"}, task)
        task, outcome = await _exec_action(db, {"type": "set_assignee", "value": ""}, task)
        assert task.assignee is None
        assert outcome["outcome"] == "applied"

    @pytest.mark.asyncio
    async def test_setting_a_field_to_what_it_already_holds_is_a_no_op(self, db, project_and_task):
        """Idempotent is correct, but it is not a change, and the record has to say so."""
        _, task = project_and_task
        task, outcome = await _exec_action(db, {"type": "set_priority", "value": "low"}, task)
        assert task.priority == "low"
        assert (outcome["outcome"], outcome["reason"]) == ("no_op", "unchanged")
        # A no-op writes nothing downstream either: no status/priority activity entry.
        assert db.query(ActivityLog).count() == 0

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
            trigger="node.updated",
            conditions=[{"field": "status", "op": "eq", "value": "done"}],
            actions=[{"type": "add_comment", "value": "Task completed!"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})
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
            trigger="node.updated",
            conditions=[{"field": "status", "op": "eq", "value": "todo"}],
            actions=[{"type": "add_comment", "value": "Should not appear"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is None
        assert rule.run_count == 0

    @pytest.mark.asyncio
    async def test_inactive_rule_skipped(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Disabled rule",
            trigger="node.updated",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=False,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})
        assert task.priority == "high"

    @pytest.mark.asyncio
    async def test_wrong_trigger_skipped(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="On create only",
            trigger="node.created",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})
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
            trigger="node.updated",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})
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
                trigger="node.created",
                conditions=[],
                actions=[{"type": "set_status", "value": "in_progress"}],
                active=True,
                run_count=0,
            )
        )
        chained = WorkflowRule(
            name="B: reacts to status changes",
            trigger="node.updated",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(chained)
        db.flush()

        await run_rules(db, "node.created", task, {})

        assert graph.get_task(db, task.id).status == "in_progress"  # A ran
        db.refresh(chained)
        assert chained.run_count == 0  # B did not
        assert graph.get_task(db, task.id).priority == "high"

    @pytest.mark.asyncio
    async def test_multiple_conditions_and_logic(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Both conditions",
            trigger="node.updated",
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

        await run_rules(db, "node.updated", task, {})
        db.flush()

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is not None
        assert c.body == "Both matched"

    @pytest.mark.asyncio
    async def test_multiple_conditions_partial_match_skips(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="Partial match",
            trigger="node.updated",
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

        await run_rules(db, "node.updated", task, {})

        c = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert c is None

    @pytest.mark.asyncio
    async def test_no_conditions_always_matches(self, db, setup):
        project, task = setup
        rule = WorkflowRule(
            name="No conditions",
            trigger="node.updated",
            conditions=[],
            actions=[{"type": "set_assignee", "value": "bot"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()

        await run_rules(db, "node.updated", task, {})
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
    async def test_unknown_label_is_a_visible_no_op(self, db, project_and_task):
        """The label the project does not have used to fail with only a log line.

        This is the user-visible case: a rule naming a label nobody ever created runs
        happily forever, raising its run_count, and never says the label is missing.
        """
        project, task = project_and_task
        await _exec_action(db, {"type": "add_label", "value": "nope"}, task)
        db.flush()

        assert graph.label_ids_for_task(db, task.id) == []
        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").one()
        assert skipped.meta["reason"] == "label_not_found"
        assert "nope" in skipped.detail
        # Scoped so it lands in the feed the user is looking at, not only the global one.
        assert (skipped.project_id, skipped.task_id) == (project.id, task.id)

    @pytest.mark.asyncio
    async def test_a_value_outside_the_enum_is_a_visible_no_op(self, db, project_and_task):
        """Rejected at write time since ADR-0046, so only pre-existing rules get here."""
        _, task = project_and_task
        await _exec_action(db, {"type": "set_status", "value": "archived"}, task)
        db.flush()

        assert graph.get_task(db, task.id).status == "todo"
        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").one()
        assert skipped.meta["reason"] == "invalid_value"


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
        # The context fields (ADR-0055) share one ``field in CONTEXT_FIELDS`` branch
        # instead of an ``== "x"`` clause each, so the scan cannot see them individually.
        # Same argument as FIELD_ACTIONS below: the set is a runtime-inspectable table,
        # and it is built from TRIGGER_CONTEXT_FIELDS, so a field no trigger supplies
        # cannot get into it.
        assert self._handled(source, "field") | rules_engine.CONTEXT_FIELDS == rules_engine.CONDITION_FIELDS
        assert rules_engine.CONTEXT_FIELDS == set().union(*rules_engine.TRIGGER_CONTEXT_FIELDS.values())

    def test_condition_ops(self, source):
        assert self._handled(source, "op") == rules_engine.CONDITION_OPS

    def test_action_types(self, source):
        # The three field actions dispatch through the FIELD_ACTIONS table rather than an
        # ``atype ==`` branch, so the scan cannot see them. A table is a stronger pin than
        # a scan — it is inspectable at runtime — and TestExecAction proves each key
        # writes its field end to end.
        assert self._handled(source, "atype") | set(rules_engine.FIELD_ACTIONS) == rules_engine.ACTION_TYPES

    def test_every_field_action_names_a_real_task_field(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T")
        db.add(task)
        db.flush()
        view = graph.get_task(db, task.id)
        for field in rules_engine.FIELD_ACTIONS.values():
            assert hasattr(view, field), field


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
        rule = WorkflowRule(name="R", trigger="node.updated", conditions=[], actions=actions, active=True, run_count=0)
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
        await run_rules(db, "node.updated", task, {})

        assert ("task.status_changed", "rule") in fired
        assert ("task.done", "rule") in fired

    @pytest.mark.asyncio
    async def test_status_action_logs_the_change(self, db, setup):
        project, task = setup
        self._rule(db, [{"type": "set_status", "value": "done"}])

        await run_rules(db, "node.updated", task, {})

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

        await run_rules(db, "node.updated", task, {})

        assert called == []


class TestRulesSeeEveryNode:
    """``node.created`` fires for every node type, not only task-role ones (ADR-0049).

    Before this, a user could define a ``proposal`` type and have no way at all to say
    "when a proposal is created, tell my external system": non-task nodes never reached
    the engine, and the conditions could not read a node's type or roles.
    """

    @pytest.fixture()
    def proposal(self, db):
        """A node with no task role, inside a project."""
        db.add(NodeType(key="proposal", label="Proposal", is_builtin=False, roles=[]))
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        node = Node(type="proposal", title="Adopt the graph model", status="todo")
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
    async def test_a_rule_runs_on_a_non_task_node(self, db, proposal):
        _, node = proposal
        rule = self._rule(db, conditions=[], actions=[{"type": "fire_event", "value": "proposal.made"}])

        await run_rules(db, "node.created", node, {})

        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_type_condition_narrows_to_one_type(self, db, proposal):
        _, node = proposal
        matching = self._rule(
            db,
            conditions=[{"field": "type", "op": "eq", "value": "proposal"}],
            actions=[{"type": "fire_event", "value": "proposal.made"}],
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
    async def test_has_role_condition_is_how_a_rule_stays_task_only(self, db, proposal):
        """The shape the Alembic migration rewrites every old ``task.created`` rule into."""
        _, node = proposal
        rule = self._rule(
            db,
            conditions=[{"field": "has_role", "op": "eq", "value": "task"}],
            actions=[{"type": "fire_event", "value": "nope"}],
        )

        await run_rules(db, "node.created", node, {})
        db.refresh(rule)
        assert rule.run_count == 0

        task = make_task(db, project_id=proposal[0].id, title="T", status="todo")
        db.add(task)
        db.flush()
        await run_rules(db, "node.created", graph.get_task(db, task.id), {})
        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_a_task_only_action_is_skipped_visibly(self, db, proposal):
        """Not a silent no-op: the activity feed says which action and why (ADR-0049)."""
        _, node = proposal
        self._rule(db, conditions=[], actions=[{"type": "add_comment", "value": "hi"}])

        await run_rules(db, "node.created", node, {})

        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").all()
        assert len(skipped) == 1
        assert skipped[0].meta["action"] == "add_comment"
        assert skipped[0].meta["node_id"] == node.id
        assert db.query(Comment).count() == 0

    @pytest.mark.asyncio
    async def test_fire_event_is_scoped_to_the_nearest_container(self, db, proposal):
        project, node = proposal
        assert graph.container_of_node(db, node.id).id == project.id

    @pytest.mark.asyncio
    async def test_a_node_with_no_container_has_no_project_scope(self, db):
        db.add(NodeType(key="proposal", label="Proposal", is_builtin=False, roles=[]))
        node = Node(type="proposal", title="Orphan", status="todo")
        db.add(node)
        db.flush()

        assert graph.container_of_node(db, node.id) is None


# ── a rule that raises ───────────────────────────────────────────────────


class TestARuleThatRaises:
    """The fourth way a rule can do nothing, and until now the quietest one.

    ``_skip`` covers the three deliberate ones. An action that *raises* used to leave a
    ``logger.warning`` and nothing else, while ``db.rollback()`` threw away whatever
    earlier rules had already written.
    """

    @staticmethod
    def _rule(db, name, actions):
        rule = WorkflowRule(name=name, trigger="node.created", conditions=[], actions=actions, active=True, run_count=0)
        db.add(rule)
        db.flush()
        return rule

    @pytest.fixture()
    def task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T", status="todo")
        db.add(task)
        db.flush()
        return graph.get_task(db, task.id)

    @pytest.mark.asyncio
    async def test_a_raising_rule_is_recorded_in_the_activity_feed(self, db, task, monkeypatch):
        rule = self._rule(db, "Boom", [{"type": "set_priority", "value": "high"}])

        async def boom(*a, **kw):
            raise RuntimeError("kaboom")

        monkeypatch.setattr(rules_engine, "_apply_fields", boom)
        await run_rules(db, "node.created", task, {})

        rows = db.query(ActivityLog).filter(ActivityLog.action == "rule.failed").all()
        assert len(rows) == 1
        assert rows[0].meta["rule_id"] == rule.id
        assert "kaboom" in rows[0].meta["error"]
        # Scoped, or the project activity page would never show it.
        assert rows[0].task_id == task.id
        assert rows[0].project_id == graph.project_id_of_task(db, task.id)

    @pytest.mark.asyncio
    async def test_one_broken_rule_does_not_undo_another(self, db, task, monkeypatch):
        """A savepoint per rule: the failure rolls back its own writes, nothing else."""
        good = self._rule(db, "Good", [{"type": "add_comment", "value": "ran"}])
        bad = self._rule(db, "Bad", [{"type": "set_priority", "value": "high"}])

        async def boom(*a, **kw):
            raise RuntimeError("kaboom")

        monkeypatch.setattr(rules_engine, "_apply_fields", boom)
        await run_rules(db, "node.created", task, {})

        db.refresh(good)
        db.refresh(bad)
        assert good.run_count == 1
        assert bad.run_count == 0
        assert db.query(Comment).count() == 1


class TestTheExecutionRecordSaysWhatItSetOff:
    """``Rule "R" executed on task "T"`` records that something ran and nothing about
    what it did — the same defect as a ``ran 47×`` counter, moved into the feed.

    Every run now carries a per-action outcome, and the four outcomes are distinct:
    applied (changed something), no_op (ran correctly, changed nothing), skipped
    (could not run), failed (raised). ADR-0053.
    """

    @pytest.fixture()
    def project_and_task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T", status="todo", priority="low")
        db.add(task)
        db.flush()
        return project, graph.get_task(db, task.id)

    def _rule(self, db, name, actions, project_id=None):
        rule = WorkflowRule(
            name=name,
            project_id=project_id,
            trigger="node.created",
            conditions=[],
            actions=actions,
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.flush()
        return rule

    def _executed(self, db):
        return db.query(ActivityLog).filter(ActivityLog.action == "rule.executed").one()

    @pytest.mark.asyncio
    async def test_an_applied_action_names_the_change(self, db, project_and_task):
        _, task = project_and_task
        self._rule(db, "Escalate", [{"type": "set_priority", "value": "high"}])

        await run_rules(db, "node.created", task, {})

        entry = self._executed(db)
        assert entry.meta["effect_count"] == 1
        assert entry.meta["actions"] == [{"type": "set_priority", "value": "high", "outcome": "applied", "from": "low"}]
        assert "priority low -> high" in entry.detail

    @pytest.mark.asyncio
    async def test_a_run_where_nothing_changed_says_so(self, db, project_and_task):
        """The state the previous ADRs missed: it ran, it succeeded, it did nothing."""
        _, task = project_and_task
        rule = self._rule(db, "Idempotent", [{"type": "set_priority", "value": "low"}])

        await run_rules(db, "node.created", task, {})

        entry = self._executed(db)
        assert entry.meta["effect_count"] == 0
        assert entry.meta["actions"][0]["outcome"] == "no_op"
        assert "no effect" in entry.detail
        assert "priority already low" in entry.detail
        db.refresh(rule)
        # It still ran — the run counter is honest, it is just not the whole story.
        assert (rule.run_count, rule.effect_count) == (1, 0)

    @pytest.mark.asyncio
    async def test_an_event_nobody_subscribed_to_is_a_no_op_not_a_success(self, db, project_and_task):
        """The silent empty set of ADR-0047, seen from the sending end."""
        _, task = project_and_task
        self._rule(db, "Announce", [{"type": "fire_event", "value": "deploy.requested"}])

        await run_rules(db, "node.created", task, {})

        record = self._executed(db).meta["actions"][0]
        assert (record["outcome"], record["reason"], record["subscribers"]) == ("no_op", "no_subscribers", 0)
        assert "to no subscriber" in self._executed(db).detail

    @pytest.mark.asyncio
    async def test_a_subscribed_event_counts_its_listeners(self, db, project_and_task, monkeypatch):
        from app.models import Integration
        from app.services import notifier

        project, task = project_and_task
        db.add(
            Integration(
                name="Hook",
                type="webhook",
                url="https://example.com",
                project_id=project.id,
                events=["deploy.requested"],
                active=True,
            )
        )
        db.flush()
        self._rule(db, "Announce", [{"type": "fire_event", "value": "deploy.requested"}])

        async def no_send(*a, **kw):
            return True

        monkeypatch.setattr(notifier, "_dispatch_webhook", no_send)
        await run_rules(db, "node.created", task, {})

        record = self._executed(db).meta["actions"][0]
        assert (record["outcome"], record["subscribers"]) == ("applied", 1)
        assert "to 1 subscriber" in self._executed(db).detail

    @pytest.mark.asyncio
    async def test_a_skipped_action_names_the_rule_that_skipped_it(self, db, project_and_task):
        """Without rule_id the feed says an action was skipped and leaves the reader to
        guess which of their rules said it."""
        _, task = project_and_task
        rule = self._rule(db, "Tagger", [{"type": "add_label", "value": "nope"}])

        await run_rules(db, "node.created", task, {})

        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").one()
        assert skipped.meta["rule_id"] == rule.id
        assert skipped.meta["rule_name"] == "Tagger"
        # And the run's own record carries the same skip, so one entry tells the story.
        assert self._executed(db).meta["actions"][0]["outcome"] == "skipped"
        assert self._executed(db).meta["effect_count"] == 0

    @pytest.mark.asyncio
    async def test_every_action_produces_exactly_one_record(self, db, project_and_task):
        """An action that returns without a record is the silent path this keeps reopening."""
        project, task = project_and_task
        graph.create_label(db, project.id, name="urgent", color="#f00")
        self._rule(
            db,
            "Everything",
            [
                {"type": "set_status", "value": "in_progress"},
                {"type": "add_label", "value": "urgent"},
                {"type": "add_label", "value": "urgent"},
                {"type": "add_comment", "value": "note"},
                {"type": "fire_event", "value": "custom.thing"},
            ],
        )

        await run_rules(db, "node.created", task, {})

        records = self._executed(db).meta["actions"]
        assert len(records) == 5
        assert [r["outcome"] for r in records] == ["applied", "applied", "no_op", "applied", "no_op"]
        assert all(r["outcome"] in rules_engine.OUTCOMES for r in records)
        assert self._executed(db).meta["effect_count"] == 3

    @pytest.mark.asyncio
    async def test_effect_count_only_moves_when_something_changed(self, db, project_and_task):
        _, task = project_and_task
        rule = self._rule(db, "Escalate", [{"type": "set_priority", "value": "high"}])

        await run_rules(db, "node.created", task, {})
        task = graph.get_task(db, task.id)
        await run_rules(db, "node.created", task, {})

        db.refresh(rule)
        # Ran twice; only the first run changed anything.
        assert (rule.run_count, rule.effect_count) == (2, 1)


class TestPredictionIsWhatExecutionDoes:
    """The dry-run used to echo ``rule.actions`` back verbatim: the rule's own
    configuration returned as if it were a result. It reported "would fire: add_label
    security" for a rule that skipped every single time, because no such label existed.

    One function decides now — ``predict_outcome`` — and execution performs whatever it
    says. Two implementations of "would this work" is one more than can be kept in step,
    and the one that drifts is the one telling the user their rule is fine. ADR-0054.
    """

    @pytest.fixture()
    def project_and_task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        task = make_task(db, project_id=project.id, title="T", status="todo", priority="low")
        db.add(task)
        db.flush()
        graph.create_label(db, project.id, name="urgent", color="#f00")
        db.flush()
        return project, graph.get_task(db, task.id)

    @pytest.mark.parametrize(
        "action",
        [
            {"type": "set_status", "value": "done"},  # applied
            {"type": "set_priority", "value": "low"},  # no_op: already low
            {"type": "set_status", "value": "archived"},  # skipped: outside the enum
            {"type": "set_assignee", "value": "bob"},
            {"type": "add_label", "value": "urgent"},
            {"type": "add_label", "value": "nope"},  # skipped: no such label
            {"type": "remove_label", "value": "urgent"},  # no_op: not attached
            {"type": "add_comment", "value": "hello"},
            {"type": "fire_event", "value": "custom.thing"},  # no_op: no subscriber
        ],
    )
    @pytest.mark.asyncio
    async def test_the_prediction_matches_what_running_it_records(self, db, project_and_task, action):
        _, task = project_and_task
        predicted = rules_engine.predict_outcome(db, action, task)

        _, recorded = await _exec_action(db, action, task)

        assert predicted["outcome"] == recorded["outcome"]
        assert predicted.get("reason") == recorded.get("reason")

    @pytest.mark.asyncio
    async def test_predicting_changes_nothing(self, db, project_and_task):
        """A prediction that writes is not a prediction. It must be safe to run one on
        every keystroke in the rule editor."""
        project, task = project_and_task
        before = (
            db.query(ActivityLog).count(),
            db.query(Comment).count(),
            len(graph.label_ids_for_task(db, task.id)),
        )

        for action in (
            {"type": "set_status", "value": "done"},
            {"type": "add_label", "value": "urgent"},
            {"type": "add_label", "value": "nope"},
            {"type": "add_comment", "value": "hello"},
            {"type": "fire_event", "value": "custom.thing"},
        ):
            rules_engine.predict_outcome(db, action, task)
        db.flush()

        assert graph.get_task(db, task.id).status == "todo"
        assert before == (
            db.query(ActivityLog).count(),
            db.query(Comment).count(),
            len(graph.label_ids_for_task(db, task.id)),
        )
        assert project is not None

    def test_a_skip_prediction_carries_the_same_reason_the_feed_would_show(self, db, project_and_task):
        _, task = project_and_task
        record = rules_engine.predict_outcome(db, {"type": "add_label", "value": "nope"}, task)

        assert record["outcome"] == "skipped"
        assert 'no label named "nope"' in rules_engine.skip_detail(record, task)

    def test_every_action_type_is_predictable(self, db, project_and_task):
        """A type the engine can run but not predict would make the dry-run silent about
        it — the same empty answer this module keeps having to re-close."""
        _, task = project_and_task
        for atype in rules_engine.ACTION_TYPES:
            value = sorted(rules_engine.ACTION_VALUE_ENUMS.get(atype, {"x"}))[0]
            record = rules_engine.predict_outcome(db, {"type": atype, "value": value}, task)
            assert record["outcome"] in rules_engine.OUTCOMES, atype


class TestRuleWarningsHaveNoSubject:
    """``predict_outcome`` answers "what would this do to this task". A rule is saved
    long before it has a subject, and the questions worth asking then — does this label
    exist, does anyone subscribe to this event — need no subject at all. ADR-0054."""

    @pytest.fixture()
    def project(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        return project

    def test_a_label_no_project_has_is_flagged(self, db, project):
        found = rules_engine.rule_warnings(db, [{"type": "add_label", "value": "nope"}])
        assert [(w["type"], w["reason"]) for w in found] == [("add_label", "label_not_found")]

    def test_a_label_that_exists_somewhere_is_not_flagged(self, db, project):
        """A global rule fires on every project, so a label existing anywhere is enough."""
        graph.create_label(db, project.id, name="urgent", color="#f00")
        db.flush()
        assert rules_engine.rule_warnings(db, [{"type": "add_label", "value": "urgent"}]) == []

    def test_a_project_scoped_rule_is_judged_in_its_own_project(self, db, project):
        other = make_project(db, name="Other")
        db.add(other)
        db.flush()
        graph.create_label(db, other.id, name="urgent", color="#f00")
        db.flush()

        assert rules_engine.rule_warnings(db, [{"type": "add_label", "value": "urgent"}]) == []
        found = rules_engine.rule_warnings(db, [{"type": "add_label", "value": "urgent"}], project_id=project.id)
        assert found[0]["reason"] == "label_not_found"

    def test_an_event_nobody_subscribes_to_is_flagged(self, db, project):
        found = rules_engine.rule_warnings(db, [{"type": "fire_event", "value": "deploy.requested"}])
        assert [(w["outcome"], w["reason"]) for w in found] == [("no_op", "no_subscribers")]

    def test_a_subscribed_event_is_not_flagged(self, db, project):
        from app.models import Integration

        db.add(
            Integration(
                name="Hook",
                type="webhook",
                url="https://example.com",
                project_id=project.id,
                events=["deploy.requested"],
                active=True,
            )
        )
        db.flush()
        assert rules_engine.rule_warnings(db, [{"type": "fire_event", "value": "deploy.requested"}]) == []

    def test_a_working_rule_warns_about_nothing(self, db, project):
        assert rules_engine.rule_warnings(db, [{"type": "set_status", "value": "done"}]) == []
