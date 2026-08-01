"""Rules trigger on the whole graph's change events, not only creation (ADR-0055).

ADR-0049 generalised *one* trigger. ``node.created`` fired for every node type, while
the other three stayed task-shaped: a field change on a project, a deletion of anything,
a ``contains`` edge being drawn — none of them could start a rule. That is not the
dishonest-report failure the ADRs before this one closed; it is an honest gap. But its
shape is the same one: the vocabulary the editor offers is narrower than the graph the
user actually models, so the rule they want cannot be written at all.

These tests pin the five triggers to what the dispatcher really emits, and pin the four
new condition fields to what the context really carries.
"""

import pytest

from app.models import ActivityLog, Node, NodeType, WorkflowRule
from app.services import graph
from app.services.graph_dispatch import (
    dispatch_edge_added,
    dispatch_edge_removed,
    dispatch_node_deleted,
    dispatch_node_updated,
)
from app.services.rules_engine import _eval_condition, run_rules
from tests.factories import make_project, make_task


def _rule(db, trigger, *, conditions=None, actions=None, project_id=None):
    rule = WorkflowRule(
        name=f"R:{trigger}",
        trigger=trigger,
        project_id=project_id,
        conditions=conditions or [],
        actions=actions or [{"type": "fire_event", "value": "something.happened"}],
        active=True,
        run_count=0,
    )
    db.add(rule)
    db.flush()
    return rule


@pytest.fixture()
def decision(db):
    """A node with no task role, inside a project — the case that had no trigger at all."""
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


# ── node.updated ─────────────────────────────────────────────────────────


class TestNodeUpdated:
    @pytest.mark.asyncio
    async def test_a_non_task_node_can_start_a_rule(self, db, decision):
        """ "When this decision is superseded, tell my external system" — previously unsayable."""
        _, node = decision
        rule = _rule(db, "node.updated")

        await dispatch_node_updated(db, node, {"status": "done"})

        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_a_write_that_changes_nothing_is_not_a_change(self, db, decision):
        """A PATCH echoing the current value back must not count as the field moving."""
        _, node = decision
        rule = _rule(db, "node.updated")

        await dispatch_node_updated(db, node, {"status": node.status})

        db.refresh(rule)
        assert (rule.run_count or 0) == 0

    @pytest.mark.asyncio
    async def test_changed_field_narrows_a_generic_trigger_back_down(self, db, decision):
        """The condition that replaces the old ``task.status_changed`` trigger."""
        _, node = decision
        on_status = _rule(db, "node.updated", conditions=[{"field": "changed_field", "op": "eq", "value": "status"}])
        on_title = _rule(db, "node.updated", conditions=[{"field": "changed_field", "op": "eq", "value": "title"}])

        await dispatch_node_updated(db, node, {"status": "done"})

        db.refresh(on_status)
        db.refresh(on_title)
        assert (on_status.run_count, on_title.run_count or 0) == (1, 0)

    def test_changed_field_reads_the_whole_change_set(self, db, decision):
        """One update naming two fields satisfies a condition on either of them."""
        _, node = decision
        context = {"changed": ["priority", "status"]}
        assert _eval_condition({"field": "changed_field", "op": "eq", "value": "status"}, node, context, db) is True
        assert _eval_condition({"field": "changed_field", "op": "eq", "value": "title"}, node, context, db) is False
        assert (
            _eval_condition({"field": "changed_field", "op": "in", "value": ["title", "status"]}, node, context, db)
            is True
        )

    @pytest.mark.asyncio
    async def test_a_task_update_reaches_the_same_trigger(self, db, decision):
        """Tasks and every other node type now arrive through one trigger, not two."""
        project, _ = decision
        task = make_task(db, project_id=project.id, title="T", status="todo")
        db.add(task)
        db.flush()
        rule = _rule(
            db,
            "node.updated",
            conditions=[
                {"field": "has_role", "op": "eq", "value": "task"},
                {"field": "changed_field", "op": "eq", "value": "status"},
            ],
        )

        await dispatch_node_updated(db, db.get(Node, task.id), {"status": "in_progress"})

        db.refresh(rule)
        assert rule.run_count == 1


# ── node.deleted ─────────────────────────────────────────────────────────


class TestNodeDeleted:
    @pytest.mark.asyncio
    async def test_a_deletion_can_start_a_rule(self, db, decision):
        _, node = decision
        rule = _rule(db, "node.deleted")

        await dispatch_node_deleted(db, node)

        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_a_task_deletion_reaches_the_rule_before_the_teardown(self, db, decision):
        """The subject must still exist when conditions are evaluated against it."""
        project, _ = decision
        task = make_task(db, project_id=project.id, title="Doomed", status="todo")
        db.add(task)
        db.flush()
        rule = _rule(db, "node.deleted", conditions=[{"field": "title_contains", "op": "eq", "value": "Doomed"}])

        await dispatch_node_deleted(db, db.get(Node, task.id))

        db.refresh(rule)
        assert rule.run_count == 1
        assert graph.get_task(db, task.id) is None

    @pytest.mark.asyncio
    async def test_writing_to_a_node_on_its_way_out_is_skipped_visibly(self, db, decision):
        """Not silently dropped: a write nobody will ever read is reported as skipped."""
        _, node = decision
        _rule(db, "node.deleted", actions=[{"type": "set_status", "value": "done"}])

        await dispatch_node_deleted(db, node)

        skipped = db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").all()
        assert len(skipped) == 1
        assert skipped[0].meta["reason"] == "node_deleted"
        assert "is being deleted" in skipped[0].detail

    @pytest.mark.asyncio
    async def test_fire_event_still_runs_on_a_deletion(self, db, decision):
        """The one action that outlives its subject: it leaves, it does not write back."""
        _, node = decision
        _rule(db, "node.deleted", actions=[{"type": "fire_event", "value": "decision.dropped"}])

        await dispatch_node_deleted(db, node)

        assert db.query(ActivityLog).filter(ActivityLog.action == "rule.skipped").count() == 0

    @pytest.mark.asyncio
    async def test_the_activity_entry_does_not_point_at_the_deleted_task(self, db, decision):
        """``delete_task_tree`` clears rows referencing the task, so scoping to it loses them."""
        project, _ = decision
        task = make_task(db, project_id=project.id, title="Doomed", status="todo")
        db.add(task)
        db.flush()
        _rule(db, "node.deleted", actions=[{"type": "fire_event", "value": "task.dropped"}])

        await dispatch_node_deleted(db, db.get(Node, task.id))

        executed = db.query(ActivityLog).filter(ActivityLog.action == "rule.executed").one()
        assert executed.task_id is None
        assert executed.project_id == project.id


# ── edge.added / edge.removed ────────────────────────────────────────────


class TestEdgeTriggers:
    @pytest.fixture()
    def linked(self, db, decision):
        project, node = decision
        task = make_task(db, project_id=project.id, title="T", status="todo")
        db.add(task)
        db.flush()
        return project, node, task

    @pytest.mark.asyncio
    async def test_an_edge_fires_once_for_each_end(self, db, linked):
        """Both endpoints are subjects, because neither end is reliably the interesting one.

        ``contains`` is written container -> task, so a rule about "this task was filed
        somewhere" would never see it if only the source counted.
        """
        _, node, task = linked
        rule = _rule(db, "edge.added")

        await dispatch_edge_added(db, node.id, task.id, graph.REL_DEPENDS_ON)

        db.refresh(rule)
        assert rule.run_count == 2

    @pytest.mark.asyncio
    async def test_edge_side_tells_the_two_apart(self, db, linked):
        _, node, task = linked
        as_source = _rule(db, "edge.added", conditions=[{"field": "edge_side", "op": "eq", "value": "source"}])
        as_target = _rule(db, "edge.added", conditions=[{"field": "edge_side", "op": "eq", "value": "target"}])

        await dispatch_edge_added(db, node.id, task.id, graph.REL_DEPENDS_ON)

        db.refresh(as_source)
        db.refresh(as_target)
        assert (as_source.run_count, as_target.run_count) == (1, 1)

    @pytest.mark.asyncio
    async def test_edge_type_narrows_to_one_relationship(self, db, linked):
        """The condition that replaces the old ``task.label_added`` trigger."""
        _, node, task = linked
        on_labeled = _rule(
            db, "edge.added", conditions=[{"field": "edge_type", "op": "eq", "value": graph.REL_LABELED}]
        )
        on_relates = _rule(
            db, "edge.added", conditions=[{"field": "edge_type", "op": "eq", "value": graph.REL_DEPENDS_ON}]
        )

        await dispatch_edge_added(db, node.id, task.id, graph.REL_DEPENDS_ON)

        db.refresh(on_labeled)
        db.refresh(on_relates)
        assert (on_labeled.run_count or 0, on_relates.run_count) == (0, 2)

    @pytest.mark.asyncio
    async def test_other_type_reads_the_node_at_the_far_end(self, db, linked):
        _, node, task = linked
        rule = _rule(
            db,
            "edge.added",
            conditions=[
                {"field": "has_role", "op": "eq", "value": "task"},
                {"field": "other_type", "op": "eq", "value": "decision"},
            ],
        )

        await dispatch_edge_added(db, node.id, task.id, graph.REL_DEPENDS_ON)

        # Once: the task end, whose far end is the decision. The decision end sees a task
        # at the far side and fails the has_role condition about itself.
        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_removal_is_its_own_trigger(self, db, linked):
        _, node, task = linked
        added = _rule(db, "edge.added")
        removed = _rule(db, "edge.removed")

        await dispatch_edge_added(db, node.id, task.id, graph.REL_DEPENDS_ON)
        await dispatch_edge_removed(db, node.id, task.id, graph.REL_DEPENDS_ON)

        db.refresh(added)
        db.refresh(removed)
        assert (added.run_count, removed.run_count) == (2, 2)


# ── the operator on set-valued conditions ────────────────────────────────


class TestMembershipRespectsTheOperator:
    """``has_label`` ignored ``op`` entirely, so ``neq urgent`` matched exactly the tasks
    that *do* carry urgent — a condition that reads as an exclusion and acts as its
    opposite. The context fields are set-valued too and share the fix (ADR-0055)."""

    @pytest.fixture()
    def task(self, db):
        project = make_project(db, name="P")
        db.add(project)
        db.flush()
        t = make_task(db, project_id=project.id, title="T", status="todo")
        db.add(t)
        db.flush()
        label = graph.create_label(db, project.id, name="urgent", color="#f00")
        graph.set_label(db, t.id, label.id)
        db.flush()
        return t

    def test_has_label_neq_excludes(self, db, task):
        assert _eval_condition({"field": "has_label", "op": "neq", "value": "urgent"}, task, {}, db) is False
        assert _eval_condition({"field": "has_label", "op": "neq", "value": "later"}, task, {}, db) is True

    def test_changed_field_neq_excludes(self, db, task):
        context = {"changed": ["status"]}
        assert _eval_condition({"field": "changed_field", "op": "neq", "value": "status"}, task, context, db) is False
        assert _eval_condition({"field": "changed_field", "op": "neq", "value": "title"}, task, context, db) is True


# ── a condition its trigger cannot answer ────────────────────────────────


class TestUndecidableConditions:
    def test_no_change_at_hand_is_null_not_false(self, db, decision):
        """Reporting it ``False`` would make every dry-run of a node.updated rule say
        "would not fire" — the same wrong answer as the old dry-run, mirrored."""
        _, node = decision
        assert _eval_condition({"field": "changed_field", "op": "eq", "value": "status"}, node, {}, db) is None
        assert _eval_condition({"field": "edge_type", "op": "eq", "value": "labeled"}, node, {}, db) is None

    @pytest.mark.asyncio
    async def test_an_undecidable_condition_does_not_fire_a_rule(self, db, decision):
        """``is True``, not truthiness: at run time the only way to be here is a bug."""
        _, node = decision
        rule = _rule(db, "node.created", conditions=[{"field": "changed_field", "op": "eq", "value": "status"}])

        await run_rules(db, "node.created", node, {})

        db.refresh(rule)
        assert (rule.run_count or 0) == 0
