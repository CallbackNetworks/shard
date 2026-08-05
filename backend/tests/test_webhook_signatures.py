"""An inbound callback is signed or it is not accepted (ADR-0060).

``/webhook/callback/{token}`` is deliberately unauthenticated — a CI runner cannot carry
the owner's session. That left the URL as the whole credential: it survives in browser
history, proxy logs, screenshots and pasted pipeline config, it never expires, and until
ADR-0059 a read-only API key could list 133 of them in one request.

The signature check existed the whole time and understood three provider formats. It just
began with ``if not secret: return True``, and nothing ever set a secret. These tests pin
the two halves of the fix: every task is born with a key, and a callback that cannot prove
it holds that key changes nothing.
"""

import hashlib
import hmac
import json

import pytest

from app.services import graph
from tests.factories import make_task


@pytest.fixture()
def task(db, sample_project):
    task = make_task(db, project_id=sample_project.id, title="Build", status="todo")
    db.commit()
    db.refresh(task)
    return task


def _body(payload=None):
    return json.dumps(payload or {"status": "done"}).encode()


def _hmac(secret, body):
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class TestEveryTaskIsBornSignable:
    def test_a_task_gets_a_secret_at_creation(self, task):
        # Not "can be given one": a key nobody has to switch on is a key that gets used.
        assert task.webhook_secret
        assert len(task.webhook_secret) >= 32

    def test_two_tasks_do_not_share_a_key(self, db, sample_project):
        a = make_task(db, project_id=sample_project.id, title="A")
        b = make_task(db, project_id=sample_project.id, title="B")
        db.commit()
        assert a.webhook_secret != b.webhook_secret

    def test_a_custom_task_like_node_gets_one_too(self, client, db):
        """ADR-0035: a user-defined task-like type is a first-class task, callbacks included."""
        client.post("/api/graph-types/nodes", json={"key": "chore", "label": "Chore", "roles": ["task"]})
        node_id = client.post("/api/nodes", json={"type": "chore", "title": "Sweep"}).json()["id"]

        node = graph.get_node(db, node_id)
        assert node.data["webhook_secret"]
        assert node.data["callback_token"]

    def test_the_status_flag_reports_it(self, client, db, sample_project):
        task = client.get(f"/api/projects/{sample_project.id}").json()["tasks"]
        assert task == [] or all(t["webhook_secret_set"] for t in task)


class TestUnsignedIsRejected:
    def test_an_unsigned_callback_changes_nothing(self, client, db, task):
        resp = client.post(f"/webhook/callback/{task.callback_token}", json={"status": "done"})

        assert resp.status_code == 401
        db.refresh(task)
        assert task.status == "todo"

    def test_a_wrong_key_is_rejected(self, client, db, task):
        body = _body()
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_hmac('not-the-key', body)}"},
        )

        assert resp.status_code == 401
        db.refresh(task)
        assert task.status == "todo"

    def test_a_signature_over_different_bytes_is_rejected(self, client, db, task):
        """Signing something you did not send is the classic replay dressed as a mistake."""
        signed = _body({"status": "in_progress"})
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=_body({"status": "done"}),
            headers={"X-Hub-Signature-256": f"sha256={_hmac(task.webhook_secret, signed)}"},
        )

        assert resp.status_code == 401
        db.refresh(task)
        assert task.status == "todo"

    def test_a_rejected_callback_leaves_no_build_history(self, client, db, task):
        from app.models import WebhookEvent

        client.post(f"/webhook/callback/{task.callback_token}", json={"status": "done"})

        # The row is written after verification, so an unauthenticated caller cannot
        # fill the build history of a task it merely knows the URL of.
        assert db.query(WebhookEvent).filter(WebhookEvent.task_id == task.id).count() == 0

    def test_a_node_whose_key_was_cleared_accepts_nothing(self, client, db, task):
        """Clearing the secret used to mean 'open'; it now means 'closed'."""
        graph.update_task(db, task.id, webhook_secret=None)
        db.commit()

        resp = client.post(f"/webhook/callback/{task.callback_token}", json={"status": "done"})

        assert resp.status_code == 401


class TestEveryProviderFormat:
    """The three formats the CI providers actually send, each proved end to end."""

    def test_github_hmac(self, client, db, task):
        body = _body()
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_hmac(task.webhook_secret, body)}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"

    def test_gitlab_plain_token(self, client, db, task):
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=_body(),
            headers={"X-Gitlab-Token": task.webhook_secret},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"

    def test_generic_hmac(self, client, db, task):
        body = _body()
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=body,
            headers={"X-Signature": f"sha256={_hmac(task.webhook_secret, body)}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"


class TestTheOwnerCanReadTheKey:
    """A mandatory secret nobody can read is a webhook nobody can configure."""

    def test_the_facade_returns_what_ci_needs(self, client, task):
        config = client.get(f"/api/nodes/{task.id}/webhook").json()

        assert config["secret"] == task.webhook_secret
        assert config["callback_token"] == task.callback_token
        # A path, not a URL: the server behind a proxy does not know its own origin.
        assert config["path"] == f"/webhook/callback/{task.callback_token}"

    def test_reading_it_is_recorded(self, client, db, task):
        from app.models import ActivityLog

        client.get(f"/api/nodes/{task.id}/webhook")

        row = db.query(ActivityLog).filter(ActivityLog.action == "task.webhook_secret_revealed").one()
        assert row.task_id == task.id

    def test_it_still_does_not_ride_along_in_the_task_payload(self, client, db, task, sample_project):
        payload = client.get(f"/api/projects/{sample_project.id}").json()["tasks"][0]

        # The whole point of a second factor is that it does not travel the same path as
        # the first, and the callback token does ride along here (ADR-0059).
        assert "webhook_secret" not in payload
        assert payload["webhook_secret_set"] is True

    def test_rotating_invalidates_the_old_key(self, client, db, task):
        old = task.webhook_secret

        new = client.post(f"/api/nodes/{task.id}/webhook/rotate-secret").json()["secret"]

        assert new != old
        body = _body()
        resp = client.post(
            f"/webhook/callback/{task.callback_token}",
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_hmac(old, body)}"},
        )
        assert resp.status_code == 401

    def test_a_node_that_receives_no_callbacks_has_no_config(self, client, sample_project):
        resp = client.get(f"/api/nodes/{sample_project.id}/webhook")
        assert resp.status_code == 400
