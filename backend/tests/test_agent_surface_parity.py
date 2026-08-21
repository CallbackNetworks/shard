"""The capabilities that were browser-only now have an agent-reachable door (ADR-0085).

Four things lived on the internal ``/api`` and nowhere else — which in production means
behind ``AUTH_PASSWORD``, which means a person in a browser: starting a CI/CD pipeline,
managing outbound integrations, reading the delivery log, and the entire workflow-rules
engine. ``/api/v1/subscriptions`` had already conceded that an agent registers its own
outbound callbacks, so the position was never "agents may not automate"; three quarters of
the machinery just never got a door.

Two doors onto one act is how a rule comes to hold on one surface and be missing on the
other, so the assertions that matter are sent through *both* against the same database, and
the refusals are compared including their text — both routers call the same service and
neither writes an error response (ADR-0085).
"""

import hashlib

import pytest

from app.models import ApiKey, Integration, WebhookDelivery
from tests.factories import make_task


def _key(db, name, scopes, container_id=None):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            container_id=container_id,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def admin_key(db):
    return _key(db, "sur_admin", ["read", "write", "admin"])


@pytest.fixture()
def write_key(db):
    return _key(db, "sur_write", ["read", "write"])


@pytest.fixture()
def read_key(db):
    return _key(db, "sur_read", ["read"])


def _hdr(key):
    return {"X-API-Key": key}


@pytest.fixture()
def integration(db):
    row = Integration(
        name="ci",
        type="webhook",
        url="https://example.invalid/hook",
        events=["task.done"],
        active=True,
        auth_type="api_key",
        auth_config={"header_name": "X-Deploy-Key", "header_value": "s3cret-value"},
        custom_headers={"X-Tenant-Token": "tenant-s3cret"},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestWorkflowRules:
    """The biggest of the four: an agent could perform every write forever and never
    arrange for one to happen by itself."""

    def test_an_agent_can_compose_a_rule_from_the_vocabulary_and_dry_run_it(
        self, client, db, write_key, sample_project
    ):
        vocab = client.get("/api/v1/workflow-rules/vocabulary", headers=_hdr(write_key)).json()
        assert "node.created" in vocab["triggers"]
        assert "set_priority" in vocab["action_types"]

        created = client.post(
            "/api/v1/workflow-rules",
            headers=_hdr(write_key),
            json={
                "name": "urgent on create",
                "trigger": "node.created",
                "conditions": [],
                "actions": [{"type": "set_priority", "value": "high"}],
                "project_id": sample_project.id,
            },
        )
        assert created.status_code == 201
        rule_id = created.json()["id"]

        task = make_task(db, project_id=sample_project.id, title="Subject", priority="low")
        db.commit()
        dry = client.post(
            f"/api/v1/workflow-rules/{rule_id}/test",
            headers=_hdr(write_key),
            params={"node_id": task.id},
        )
        assert dry.status_code == 200
        # The dry-run reports what the engine would do, not the rule's own config echoed
        # back (ADR-0054).
        assert dry.json()["would_fire"] is True
        assert dry.json()["actions"][0]["outcome"] == "applied"

    def test_a_rule_created_through_v1_actually_runs(self, client, db, write_key, sample_project):
        client.post(
            "/api/v1/workflow-rules",
            headers=_hdr(write_key),
            json={
                "name": "auto-high",
                "trigger": "node.created",
                "conditions": [],
                "actions": [{"type": "set_priority", "value": "high"}],
                "project_id": sample_project.id,
            },
        )
        created = client.post(
            "/api/v1/nodes",
            headers=_hdr(write_key),
            json={"type": "task", "title": "Made by an agent", "container_id": sample_project.id},
        )

        assert created.status_code == 201
        assert created.json()["priority"] == "high"

    def test_a_self_contradicting_rule_is_refused_identically_at_both_doors(self, client, write_key):
        body = {
            "name": "impossible",
            "trigger": "node.created",
            # node.created never carries a changed_field — the rule could not ever fire, so
            # this is a 422 rather than a warning (ADR-0055).
            "conditions": [{"field": "changed_field", "op": "eq", "value": "status"}],
            "actions": [{"type": "set_priority", "value": "high"}],
        }
        internal = client.post("/api/workflow-rules", json=body)
        external = client.post("/api/v1/workflow-rules", headers=_hdr(write_key), json=body)

        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_missing_rule_is_404_at_both(self, client, write_key):
        internal = client.get("/api/workflow-rules/nope")
        external = client.get("/api/v1/workflow-rules/nope", headers=_hdr(write_key))

        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_read_key_cannot_write_a_rule(self, client, read_key):
        resp = client.post(
            "/api/v1/workflow-rules",
            headers=_hdr(read_key),
            json={"name": "x", "trigger": "node.created", "actions": [{"type": "set_priority", "value": "high"}]},
        )
        assert resp.status_code == 403

    def test_a_project_scoped_key_cannot_write_a_global_rule(self, client, db, sample_project):
        scoped = _key(db, "sur_scoped_rule", ["read", "write"], container_id=sample_project.id)
        resp = client.post(
            "/api/v1/workflow-rules",
            headers=_hdr(scoped),
            json={"name": "global", "trigger": "node.created", "actions": [{"type": "set_priority", "value": "high"}]},
        )
        assert resp.status_code == 403


class TestIntegrations:
    def test_an_agent_can_create_and_list_an_integration(self, client, write_key):
        created = client.post(
            "/api/v1/integrations",
            headers=_hdr(write_key),
            json={
                "name": "deploy hook",
                "type": "webhook",
                "url": "https://example.invalid/h",
                "events": ["task.done"],
            },
        )
        assert created.status_code == 201
        listed = client.get("/api/v1/integrations", headers=_hdr(write_key)).json()
        assert any(i["name"] == "deploy hook" for i in listed)

    def test_an_event_nothing_delivers_is_refused_identically_at_both_doors(self, client, write_key):
        body = {"name": "bad", "type": "webhook", "url": "https://x.invalid", "events": ["task.teleported"]}
        internal = client.post("/api/integrations", json=body)
        external = client.post("/api/v1/integrations", headers=_hdr(write_key), json=body)

        assert internal.status_code == external.status_code == 422
        assert internal.json()["detail"] == external.json()["detail"]

    def test_credentials_do_not_come_back(self, client, write_key, integration):
        listed = client.get("/api/v1/integrations", headers=_hdr(write_key)).json()
        row = next(i for i in listed if i["id"] == integration.id)

        # ADR-0063 is not relaxed by a second door.
        assert "secret" not in row or row.get("secret") is None
        assert row["auth_config"]["header_value"] is None
        assert row["custom_headers"]["X-Tenant-Token"] is None

    def test_a_null_credential_on_update_means_unchanged(self, client, db, write_key, integration):
        """The write rule ADR-0063 forced: a client edits what it was shown, and what it was
        shown has its credentials withheld."""
        client.patch(
            f"/api/v1/integrations/{integration.id}",
            headers=_hdr(write_key),
            json={"auth_config": {"header_name": "X-Renamed", "header_value": None}},
        )
        db.refresh(integration)

        assert integration.auth_config["header_name"] == "X-Renamed"
        assert integration.auth_config["header_value"] == "s3cret-value"

    def test_a_read_key_cannot_create_one(self, client, read_key):
        resp = client.post(
            "/api/v1/integrations",
            headers=_hdr(read_key),
            json={"name": "x", "type": "webhook", "url": "https://x.invalid"},
        )
        assert resp.status_code == 403


class TestDeliveryLog:
    """Configuring a callback and being unable to read its log is half a capability: the
    failure mode of a webhook is silence."""

    @pytest.fixture()
    def delivery(self, db, integration):
        row = WebhookDelivery(
            integration_id=integration.id,
            event="task.done",
            payload={"x": 1},
            request_url=integration.url,
            # Recorded before the redaction rule existed — the point of redacting on read.
            request_headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer plaintext",
                "X-Deploy-Key": "s3cret-value",
                "X-Tenant-Token": "tenant-s3cret",
            },
            attempt=1,
            status="failed",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    def test_an_agent_can_see_a_failing_delivery(self, client, read_key, delivery):
        rows = client.get("/api/v1/deliveries", headers=_hdr(read_key), params={"status": "failed"}).json()
        assert [r["id"] for r in rows] == [delivery.id]

    def test_health_reports_the_failure(self, client, read_key, integration, delivery):
        health = client.get(f"/api/v1/integrations/{integration.id}/health", headers=_hdr(read_key)).json()
        assert health["failures"] == 1
        assert health["success_rate"] == 0.0

    @pytest.mark.parametrize("door", ["/api/deliveries", "/api/v1/deliveries"])
    def test_credential_headers_are_redacted_at_every_door(self, client, read_key, delivery, door):
        """ADR-0063 withholds `auth_config` and `custom_headers` when an integration is read.
        The delivery log stored the *resulting headers* and served them — the same
        credential leaving by a second path, and `authorization` was the whole redaction
        list back when bearer was the only auth type."""
        headers = {"X-API-Key": read_key} if door.startswith("/api/v1") else {}
        row = client.get(door, headers=headers).json()[0]

        assert row["request_headers"]["Authorization"] == "***"
        assert row["request_headers"]["X-Deploy-Key"] == "***"
        assert row["request_headers"]["X-Tenant-Token"] == "***"
        # Non-credential headers still readable, or the log stops being a log.
        assert row["request_headers"]["Content-Type"] == "application/json"

    def test_purging_the_log_takes_admin(self, client, write_key, admin_key):
        assert client.delete("/api/v1/deliveries", headers=_hdr(write_key)).status_code == 403
        assert client.delete("/api/v1/deliveries", headers=_hdr(admin_key)).status_code == 204


class TestPipelineTriggers:
    def test_an_agent_can_start_a_build_and_it_is_recorded_against_the_task(
        self, client, db, write_key, sample_project, monkeypatch
    ):
        from unittest.mock import AsyncMock

        from app.models import ActivityLog

        task = make_task(db, project_id=sample_project.id, title="Ship it")
        db.commit()
        monkeypatch.setattr(
            "app.services.cicd_dispatch.trigger_github_workflow",
            AsyncMock(return_value={"success": True, "status_code": 204}),
        )

        resp = client.post(
            "/api/v1/cicd/trigger/github",
            headers=_hdr(write_key),
            params={"task_id": task.id},
            json={"repo": "owner/repo", "workflow_id": "ci.yml", "token": "gh-token", "ref": "main"},
        )

        assert resp.status_code == 200
        assert resp.json()["success"] is True
        row = db.query(ActivityLog).filter(ActivityLog.action == "cicd.triggered").one()
        assert row.task_id == task.id
        # The key that pulled the trigger, not a generic "user" (both doors share the act,
        # so the actor is the only thing that differs).
        assert row.actor == "api:sur_write"

    def test_a_read_key_cannot_start_a_build(self, client, read_key):
        resp = client.post(
            "/api/v1/cicd/trigger/generic",
            headers=_hdr(read_key),
            json={"url": "https://example.invalid/build"},
        )
        assert resp.status_code == 403


class TestCallbackAddressRotation:
    """`rotate-secret` answers "the key leaked"; only this answers "the URL leaked", and a
    callback URL is what ends up in pipeline config and screenshots."""

    def test_rotating_the_token_changes_the_address_and_keeps_the_key(self, client, db, admin_key, sample_project):
        task = make_task(db, project_id=sample_project.id, title="Build")
        db.commit()
        before = client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(admin_key)).json()

        after = client.post(f"/api/v1/nodes/{task.id}/webhook/rotate-token", headers=_hdr(admin_key)).json()

        assert after["callback_token"] != before["callback_token"]
        assert after["secret"] == before["secret"]
        assert after["path"] == f"/webhook/callback/{after['callback_token']}"

    def test_the_old_address_stops_resolving(self, client, db, admin_key, sample_project):
        task = make_task(db, project_id=sample_project.id, title="Build")
        db.commit()
        old = client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(admin_key)).json()

        client.post(f"/api/v1/nodes/{task.id}/webhook/rotate-token", headers=_hdr(admin_key))

        assert client.post(old["path"], json={"status": "done"}).status_code == 404

    def test_the_task_route_and_the_node_route_are_one_act(self, client, db, sample_project):
        """`POST /projects/{p}/tasks/{t}/regenerate-token` predates the node surface and had
        its own copy of the write and its own activity row."""
        from app.models import ActivityLog, Node

        task = make_task(db, project_id=sample_project.id, title="Build")
        db.commit()
        # Read the node's own data, not the fixture's snapshot attributes: `make_task`
        # decorates the returned Node with read-only copies that a refresh never updates.
        before = db.get(Node, task.id).data["callback_token"]

        client.post(f"/api/projects/{sample_project.id}/tasks/{task.id}/regenerate-token")

        db.expire_all()
        assert db.get(Node, task.id).data["callback_token"] != before
        # One act, so one kind of row — this route used to write its own.
        assert db.query(ActivityLog).filter(ActivityLog.action == "task.callback_token_rotated").count() == 1
