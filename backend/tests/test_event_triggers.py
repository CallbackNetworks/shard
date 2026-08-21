"""A rule may trigger on a named notification event, not only a structural graph event
(ADR-0106).

``notifier._deliver`` is the one place every ``fire_notifications`` / ``fire_project_
notifications`` / ``fire_node_notifications`` call funnels through, so it is also the one
place a named event can reach the rules engine — at the exact instant it would have
reached a subscribed integration. These tests pin: the bridge actually fires rules, it
fires them even with zero integration subscribers, it respects the ADR-0048 no-chaining
invariant, and the trigger vocabulary rejects names that could never work as a trigger.
"""

import hashlib

import pytest

from app.models import ApiKey, Comment, WorkflowRule
from app.services import task_mutations
from app.services.event_catalog import TRIGGERABLE_EVENTS, subscribable_triggers, validate_trigger
from app.services.rules_engine import SUPPORTED_TRIGGERS
from tests.factories import make_project, make_task


@pytest.fixture()
def project_and_task(db):
    project = make_project(db, name="P")
    db.add(project)
    db.flush()
    task = make_task(db, project_id=project.id, title="Ship it", status="todo", priority="medium")
    db.add(task)
    db.commit()
    return project, task


class TestEventCatalogValidation:
    def test_structural_triggers_are_valid(self, db):
        for trigger in SUPPORTED_TRIGGERS:
            assert validate_trigger(db, trigger) == trigger

    def test_a_triggerable_event_is_valid(self, db):
        assert validate_trigger(db, "task.done") == "task.done"

    def test_rule_triggered_is_not_a_valid_trigger(self, db):
        """It only ever fires with source="rule", so it could never pass the chain guard —
        offering it would be a trigger that looks healthy and never runs."""
        assert "rule.triggered" not in TRIGGERABLE_EVENTS
        with pytest.raises(ValueError, match="rule.triggered"):
            validate_trigger(db, "rule.triggered")

    def test_a_custom_fire_event_name_is_not_a_valid_trigger(self, db):
        """Subscribable (for integrations) but not triggerable (for rules): a custom event
        is, by construction, only ever emitted by a rule's own action."""
        db.add(
            WorkflowRule(
                name="emits a custom event",
                trigger="node.updated",
                conditions=[],
                actions=[{"type": "fire_event", "value": "deploy.requested"}],
                active=True,
            )
        )
        db.commit()
        with pytest.raises(ValueError):
            validate_trigger(db, "deploy.requested")

    def test_unknown_trigger_is_rejected(self, db):
        with pytest.raises(ValueError):
            validate_trigger(db, "task.exploded")

    def test_subscribable_triggers_is_structural_plus_triggerable(self, db):
        assert subscribable_triggers(db) == list(SUPPORTED_TRIGGERS) + TRIGGERABLE_EVENTS


class TestNamedEventTriggersFire:
    @pytest.mark.asyncio
    async def test_a_task_done_rule_fires_when_a_task_is_completed(self, db, project_and_task):
        _, task = project_and_task
        rule = WorkflowRule(
            name="celebrate",
            trigger="task.done",
            conditions=[],
            actions=[{"type": "add_comment", "value": "Nice work!"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.commit()

        await task_mutations.apply_task_update(db, task.id, {"status": "done"}, source="user")

        db.refresh(rule)
        assert rule.run_count == 1
        comment = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert comment is not None
        assert comment.body == "Nice work!"

    @pytest.mark.asyncio
    async def test_it_fires_even_with_no_integration_subscribed(self, db, project_and_task):
        """Whether anyone subscribes and whether a rule cares are unrelated questions."""
        _, task = project_and_task
        rule = WorkflowRule(
            name="no subscribers needed",
            trigger="task.done",
            conditions=[],
            actions=[{"type": "set_priority", "value": "low"}],
            active=True,
            run_count=0,
        )
        db.add(rule)
        db.commit()

        await task_mutations.apply_task_update(db, task.id, {"status": "done"}, source="api")

        db.refresh(rule)
        assert rule.run_count == 1

    @pytest.mark.asyncio
    async def test_a_status_changed_rule_and_a_done_rule_can_both_fire(self, db, project_and_task):
        _, task = project_and_task
        generic = WorkflowRule(
            name="any status change",
            trigger="task.status_changed",
            conditions=[],
            actions=[{"type": "add_comment", "value": "status moved"}],
            active=True,
            run_count=0,
        )
        specific = WorkflowRule(
            name="specifically done",
            trigger="task.done",
            conditions=[],
            actions=[{"type": "add_comment", "value": "it's done"}],
            active=True,
            run_count=0,
        )
        db.add_all([generic, specific])
        db.commit()

        await task_mutations.apply_task_update(db, task.id, {"status": "done"}, source="user")

        db.refresh(generic)
        db.refresh(specific)
        assert generic.run_count == 1
        assert specific.run_count == 1

    @pytest.mark.asyncio
    async def test_a_rule_causing_completion_does_not_retrigger_a_done_rule(self, db, project_and_task):
        """ADR-0048's no-chaining invariant extended to named-event triggers: a status
        change a *rule* makes must not feed back into another rule via the new bridge,
        exactly as it already cannot via the structural node.updated trigger."""
        project, task = project_and_task
        mover = WorkflowRule(
            name="auto-complete on creation",
            trigger="node.created",
            conditions=[],
            actions=[{"type": "set_status", "value": "done"}],
            active=True,
            run_count=0,
        )
        listener = WorkflowRule(
            name="reacts to done",
            trigger="task.done",
            conditions=[],
            actions=[{"type": "add_comment", "value": "should not appear"}],
            active=True,
            run_count=0,
        )
        db.add_all([mover, listener])
        db.commit()

        from app.services.rules_engine import run_rules

        await run_rules(db, "node.created", task, {})

        db.refresh(mover)
        db.refresh(listener)
        assert mover.run_count == 1
        assert listener.run_count == 0
        comment = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert comment is None


@pytest.fixture()
def write_key(db):
    raw = "tdp_test_event_trigger_write"
    db.add(
        ApiKey(
            name="event-trigger-write",
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read", "write"],
            active=True,
        )
    )
    db.commit()
    return raw


def _hdr(key):
    return {"X-API-Key": key}


class TestTriggerValidationAtBothDoors:
    def test_a_named_event_trigger_is_accepted_at_both_doors(self, client, write_key):
        body = {
            "name": "done rule",
            "trigger": "task.done",
            "actions": [{"type": "set_priority", "value": "low"}],
        }
        internal = client.post("/api/workflow-rules", json={**body, "name": "internal"})
        external = client.post("/api/v1/workflow-rules", headers=_hdr(write_key), json={**body, "name": "external"})

        assert internal.status_code == external.status_code == 201

    def test_an_unfireable_trigger_is_refused_identically_at_both_doors(self, client, write_key):
        body = {
            "name": "dead on arrival",
            "trigger": "rule.triggered",
            "actions": [{"type": "set_priority", "value": "high"}],
        }
        internal = client.post("/api/workflow-rules", json=body)
        external = client.post("/api/v1/workflow-rules", headers=_hdr(write_key), json=body)

        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    def test_an_unknown_trigger_is_refused_identically_at_both_doors(self, client, write_key):
        body = {
            "name": "typo",
            "trigger": "task.exploded",
            "actions": [{"type": "set_priority", "value": "high"}],
        }
        internal = client.post("/api/workflow-rules", json=body)
        external = client.post("/api/v1/workflow-rules", headers=_hdr(write_key), json=body)

        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    def test_patch_to_an_unfireable_trigger_is_refused(self, client):
        rule_id = client.post(
            "/api/workflow-rules",
            json={"name": "r", "trigger": "task.done", "actions": [{"type": "set_priority", "value": "low"}]},
        ).json()["id"]

        r = client.patch(f"/api/workflow-rules/{rule_id}", json={"trigger": "rule.triggered"})
        assert r.status_code == 422
