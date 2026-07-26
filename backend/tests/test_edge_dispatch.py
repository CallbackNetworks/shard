"""Relationship writes fire the same reactions whichever route wrote them (ADR-0045).

Before edge dispatch, the named sub-resources (labels, cycle assignment,
dependencies, memberships) each fired their own ad-hoc subset of reactions while
the generic ``/api/nodes/{id}/edges`` surface fired none. These tests pin the two
observable consequences: the activity entry and the ``task.label_added`` workflow
trigger, which no write path fired at all before.
"""

import pytest

from app.models import ActivityLog, WorkflowRule
from app.services import graph


def _task(client, project_id, title):
    return client.post("/api/nodes", json={"type": "task", "container_id": project_id, "title": title}).json()["id"]


def _label(client, project_id, name):
    return client.post("/api/nodes", json={"type": "label", "container_id": project_id, "title": name}).json()["id"]


def _actions(db, task_id, action):
    return db.query(ActivityLog).filter(ActivityLog.task_id == task_id, ActivityLog.action == action).all()


class TestLabelEdgeReactions:
    def test_named_route_logs_the_label_assignment(self, client, db, sample_project):
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "bug")

        assert client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}").status_code == 201
        entries = _actions(db, task_id, "task.label_added")
        assert len(entries) == 1
        assert entries[0].meta["label_id"] == label_id

        assert client.delete(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}").status_code == 204
        assert len(_actions(db, task_id, "task.label_removed")) == 1

    def test_generic_edge_route_logs_the_same_thing(self, client, db, sample_project):
        """The generic surface used to write the edge and fire nothing."""
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "bug")

        resp = client.post(
            f"/api/nodes/{task_id}/edges",
            json={"target_id": label_id, "rel_type": graph.REL_LABELED},
        )
        assert resp.status_code == 201
        assert len(_actions(db, task_id, "task.label_added")) == 1

    def test_double_assignment_logs_once(self, client, db, sample_project):
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "bug")

        client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")
        client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")
        assert len(_actions(db, task_id, "task.label_added")) == 1


class TestLabelAddedTrigger:
    """``task.label_added`` is an advertised trigger that nothing used to fire."""

    @pytest.fixture()
    def rule(self, db, sample_project):
        rule = WorkflowRule(
            id="rule-label",
            name="High on bug label",
            trigger="task.label_added",
            project_id=sample_project.id,
            conditions=[{"field": "has_label", "value": "bug"}],
            actions=[{"type": "set_priority", "value": "high"}],
            active=True,
        )
        db.add(rule)
        db.commit()
        return rule

    def test_rule_runs_when_a_label_is_attached(self, client, db, sample_project, rule):
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "bug")

        client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")

        assert graph.get_task(db, task_id).priority == "high"
        db.refresh(rule)
        assert rule.run_count == 1

    def test_rule_does_not_run_on_a_non_matching_label(self, client, db, sample_project, rule):
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "chore")

        client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")

        assert graph.get_task(db, task_id).priority != "high"
        db.refresh(rule)
        assert (rule.run_count or 0) == 0

    def test_rule_does_not_run_on_removal(self, client, db, sample_project, rule):
        pid = sample_project.id
        task_id = _task(client, pid, "T")
        label_id = _label(client, pid, "bug")
        client.post(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")
        db.refresh(rule)
        before = rule.run_count

        client.delete(f"/api/projects/{pid}/tasks/{task_id}/labels/{label_id}")

        db.refresh(rule)
        assert rule.run_count == before


class TestMembershipEdgeReactions:
    def test_named_and_generic_routes_agree(self, client, db, sample_project):
        """Both the membership sub-resource and a raw contains edge log a membership change."""
        pid = sample_project.id
        other = client.post("/api/nodes", json={"type": "project", "title": "Other"}).json()["id"]
        via_route = _task(client, pid, "A")
        via_edge = _task(client, pid, "B")

        assert client.post(f"/api/projects/{pid}/tasks/{via_route}/memberships/{other}").status_code == 201
        resp = client.post(
            f"/api/nodes/{other}/edges",
            json={"target_id": via_edge, "rel_type": graph.REL_CONTAINS},
        )
        assert resp.status_code == 201

        for task_id in (via_route, via_edge):
            entries = _actions(db, task_id, "task.membership_added")
            assert len(entries) == 1, task_id
            assert entries[0].meta["container_id"] == other
