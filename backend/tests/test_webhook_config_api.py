"""Configuring inbound CI/CD is not a browser-only act (ADR-0084).

The callback credentials — the token that *is* the address and the secret that signs what
arrives at it — could only be read from ``GET /api/nodes/{id}/webhook``. That is the
internal surface, which in production sits behind ``AUTH_PASSWORD``, so an API key or an
MCP client could not reach it at all: an agent could create the task, could subscribe to
outbound events for it, and then had to hand the last step to a person with a browser.

Two doors onto one act is how a rule comes to hold on one surface and be missing on the
other (ADR-0070→0073 was the bill for exactly that), so the interesting assertions here
are the ones sent through *both* doors against the same database, and the ones that pin
where the doors are meant to differ: who is allowed to ask.
"""

import hashlib
import hmac
import json

import pytest

from app.models import ActivityLog, ApiKey
from app.services import graph
from tests.factories import make_task


def _key(db, name, scopes):
    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def admin_key(db):
    return _key(db, "wh_admin", ["read", "write", "admin"])


@pytest.fixture()
def write_key(db):
    return _key(db, "wh_write", ["read", "write"])


@pytest.fixture()
def read_key(db):
    return _key(db, "wh_read", ["read"])


@pytest.fixture()
def task(db, sample_project):
    task = make_task(db, project_id=sample_project.id, title="Build", status="todo")
    db.commit()
    db.refresh(task)
    return task


def _hdr(key):
    return {"X-API-Key": key}


def _body(payload=None):
    return json.dumps(payload or {"status": "done"}).encode()


def _sign(secret, body):
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class TestTheGapItself:
    """What an agent could not do before: set up CI end to end without a browser."""

    def test_an_api_key_can_configure_a_task_and_the_callback_it_configured_works(self, client, db, admin_key, task):
        config = client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(admin_key)).json()

        body = _body({"status": "done"})
        resp = client.post(
            config["path"],
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_sign(config['secret'], body)}"},
        )

        assert resp.status_code == 200
        db.refresh(task)
        assert task.status == "done"

    def test_a_container_is_provisioned_lazily_through_v1_too(self, client, admin_key, sample_project):
        """A project is never minted with these (ADR-0082); the first reveal creates them,
        and it must not matter which door asked first."""
        first = client.get(f"/api/v1/nodes/{sample_project.id}/webhook", headers=_hdr(admin_key))
        assert first.status_code == 200
        assert first.json()["callback_token"]
        assert first.json()["secret"]

        again = client.get(f"/api/nodes/{sample_project.id}/webhook").json()
        assert again == first.json()

    def test_rotating_through_v1_invalidates_the_old_secret(self, client, admin_key, task):
        old = task.webhook_secret

        rotated = client.post(f"/api/v1/nodes/{task.id}/webhook/rotate-secret", headers=_hdr(admin_key)).json()

        assert rotated["secret"] != old
        # The address is unchanged — only the key that signs for it.
        assert rotated["callback_token"] == task.callback_token
        body = _body()
        stale = client.post(
            rotated["path"],
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_sign(old, body)}"},
        )
        assert stale.status_code == 401


class TestBothDoorsGiveTheSameAnswer:
    """One act, two surfaces. Divergence here is the defect this ADR exists to prevent."""

    def test_reveal_returns_an_identical_config(self, client, admin_key, task):
        internal = client.get(f"/api/nodes/{task.id}/webhook").json()
        external = client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(admin_key)).json()

        assert internal == external
        assert external["path"] == f"/webhook/callback/{external['callback_token']}"

    @pytest.mark.parametrize("verb", ["reveal", "rotate"])
    def test_a_type_that_receives_no_callbacks_is_refused_the_same_way(self, client, db, admin_key, verb):
        # A label: neither container nor task, so nothing can be posted against it.
        # Identity played this part until ADR-0095 gave it the container role.
        label = graph.create_label(db, project_id=None, name="chore")
        db.commit()
        if verb == "reveal":
            internal = client.get(f"/api/nodes/{label.id}/webhook")
            external = client.get(f"/api/v1/nodes/{label.id}/webhook", headers=_hdr(admin_key))
        else:
            internal = client.post(f"/api/nodes/{label.id}/webhook/rotate-secret")
            external = client.post(f"/api/v1/nodes/{label.id}/webhook/rotate-secret", headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]

    def test_an_unknown_node_is_404_at_both(self, client, admin_key):
        internal = client.get("/api/nodes/does-not-exist/webhook")
        external = client.get("/api/v1/nodes/does-not-exist/webhook", headers=_hdr(admin_key))

        assert internal.status_code == external.status_code == 404

    def test_a_custom_task_like_type_is_configurable_through_v1(self, client, db, admin_key):
        """ADR-0035: a user-defined task-like type is a first-class task. The v1 door must
        read the same registry, not a hard-coded list of built-ins."""
        client.post("/api/graph-types/nodes", json={"key": "chore", "label": "Chore", "roles": ["task"]})
        node_id = client.post("/api/nodes", json={"type": "chore", "title": "Sweep"}).json()["id"]

        resp = client.get(f"/api/v1/nodes/{node_id}/webhook", headers=_hdr(admin_key))

        assert resp.status_code == 200
        assert resp.json()["secret"] == graph.get_node(db, node_id).data["webhook_secret"]


class TestWhoMayAsk:
    """Where the doors differ on purpose. A token plus its signing key mints an
    unauthenticated write path into the platform, so it is an admin act — and the v1
    redaction middleware would strip ``callback_token`` from a lesser key's response
    anyway (ADR-0059), handing back a config with the address silently missing."""

    @pytest.mark.parametrize("scope_key", ["read_key", "write_key"])
    def test_a_lesser_key_is_refused_rather_than_served_a_gutted_config(self, client, task, scope_key, request):
        key = request.getfixturevalue(scope_key)

        reveal = client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(key))
        rotate = client.post(f"/api/v1/nodes/{task.id}/webhook/rotate-secret", headers=_hdr(key))

        assert reveal.status_code == rotate.status_code == 403

    def test_an_unknown_key_gets_nothing(self, client, task):
        assert client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr("tdp_nope")).status_code == 401
        # A missing header never reaches the dependency: FastAPI refuses it as 422.
        assert client.get(f"/api/v1/nodes/{task.id}/webhook").status_code == 422

    def test_a_project_scoped_key_cannot_reach_another_projects_task(self, client, db, task):
        other = graph.create_node(db, graph.NODE_PROJECT, title="Elsewhere")
        db.commit()
        raw = "tdp_test_scoped"
        db.add(
            ApiKey(
                name="wh_scoped",
                key=raw,
                key_hash=hashlib.sha256(raw.encode()).hexdigest(),
                key_last4=raw[-4:],
                scopes=["read", "write", "admin"],
                project_id=other.id,
                active=True,
            )
        )
        db.commit()

        assert client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(raw)).status_code == 403


class TestTheRevealIsRecorded:
    """A credential handed out without a row saying so is one nobody can audit. The log
    lives with the act, not in each router, so a third door gets it for free."""

    def test_the_activity_row_names_the_key_that_asked(self, client, db, admin_key, task):
        client.get(f"/api/v1/nodes/{task.id}/webhook", headers=_hdr(admin_key))

        row = db.query(ActivityLog).filter(ActivityLog.action == "task.webhook_secret_revealed").one()
        assert row.task_id == task.id
        assert row.actor == "api:wh_admin"

    def test_rotation_is_recorded_too(self, client, db, admin_key, task):
        client.post(f"/api/v1/nodes/{task.id}/webhook/rotate-secret", headers=_hdr(admin_key))

        row = db.query(ActivityLog).filter(ActivityLog.action == "task.webhook_secret_rotated").one()
        assert row.actor == "api:wh_admin"

    def test_a_container_logs_against_itself(self, client, db, admin_key, sample_project):
        client.get(f"/api/v1/nodes/{sample_project.id}/webhook", headers=_hdr(admin_key))

        row = db.query(ActivityLog).filter(ActivityLog.action == "project.webhook_secret_revealed").one()
        assert row.project_id == sample_project.id
        assert row.task_id is None


class TestItIsStillNotAFieldOnTheNode:
    """ADR-0059 is not relaxed by giving the reveal a v1 door: the credentials leave the
    server through this one deliberate request and no other."""

    def test_an_admin_key_reading_the_node_does_not_get_the_secret(self, client, admin_key, task):
        payload = client.get(f"/api/v1/nodes/{task.id}", headers=_hdr(admin_key)).json()

        assert "webhook_secret" not in (payload.get("data") or {})

    def test_a_read_key_listing_nodes_gets_neither(self, client, read_key, task):
        blobs = [json.dumps(n.get("data") or {}) for n in client.get("/api/v1/nodes", headers=_hdr(read_key)).json()]

        assert [b for b in blobs if "webhook_secret" in b or "callback_token" in b] == []
