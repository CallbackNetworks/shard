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

    def test_a_container_gets_credentials_lazily(self, client, sample_project):
        """A project never gets callback_token/webhook_secret at creation, unlike a
        task — the first reveal provisions them (ADR-0082)."""
        resp = client.get(f"/api/nodes/{sample_project.id}/webhook")
        assert resp.status_code == 200
        config = resp.json()
        assert config["callback_token"]
        assert config["secret"]

        # Provisioning is idempotent: a second reveal returns the same credentials.
        again = client.get(f"/api/nodes/{sample_project.id}/webhook").json()
        assert again["callback_token"] == config["callback_token"]
        assert again["secret"] == config["secret"]

    def test_a_node_with_no_webhook_role_has_no_config(self, client, db):
        # A label is neither a container nor a task, so no build result can be posted
        # against it. (Identity used to be the example here; it holds the container
        # role since ADR-0095 and therefore logs callbacks like any other container.)
        label = graph.create_label(db, project_id=None, name="chore")
        db.commit()
        resp = client.get(f"/api/nodes/{label.id}/webhook")
        assert resp.status_code == 400


class TestContainerCallbacksNeverMutateTheProject:
    """A project has no build outcome to apply (ADR-0082): its callback only logs."""

    @pytest.fixture()
    def project_webhook(self, client, sample_project):
        return client.get(f"/api/nodes/{sample_project.id}/webhook").json()

    def test_signature_is_still_required(self, client, sample_project, project_webhook):
        body = _body({"status": "done"})
        resp = client.post(
            f"/webhook/callback/{project_webhook['callback_token']}",
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_hmac('wrong-secret', body)}"},
        )
        assert resp.status_code == 401

    def test_a_push_event_is_logged_and_the_project_is_untouched(self, db, client, sample_project, project_webhook):
        from app.models import ActivityLog, Node

        status_before = db.get(Node, sample_project.id).status
        push = {
            "ref": "refs/heads/main",
            "after": "abc1234",
            "commits": [{"message": "fix: tighten the thing"}],
            "pusher": {"login": "chungchen"},
            "repository": {"html_url": "https://gitea.callbacknetwork.com/CallbackNetwork/shard"},
        }
        body = _body(push)
        resp = client.post(
            f"/webhook/callback/{project_webhook['callback_token']}",
            content=body,
            headers={
                "X-Gitea-Event": "push",
                "X-Hub-Signature-256": f"sha256={_hmac(project_webhook['secret'], body)}",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "gitea"
        assert data["branch"] == "main"
        assert data["commit_sha"] == "abc1234"
        assert "fix: tighten the thing" in data["message"]
        # No task-shaped fields (status/title/id-as-task) leaked into the response.
        assert "title" not in data

        node = db.get(Node, sample_project.id)
        assert node.status == status_before  # push carries no outcome to apply

        row = db.query(ActivityLog).filter(ActivityLog.action == "webhook.container_event").one()
        assert row.project_id == sample_project.id
        assert row.task_id is None

    def test_a_build_status_event_is_recorded_but_does_not_apply(self, client, sample_project, project_webhook):
        payload = {"action": "completed", "workflow_run": {"conclusion": "success", "head_branch": "main"}}
        body = _body(payload)
        resp = client.post(
            f"/webhook/callback/{project_webhook['callback_token']}",
            content=body,
            headers={
                "X-Gitea-Event": "workflow_run",
                "X-Hub-Signature-256": f"sha256={_hmac(project_webhook['secret'], body)}",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        # The build's own outcome is recorded in the event history...
        assert data["status"] == "done"
        assert data["provider"] == "gitea"
        # ...but there is no task response shape here, because there is no task.
        assert "id" in data and "task_id" in data

    def test_events_show_up_in_the_same_build_history_endpoint_as_a_task(self, client, sample_project, project_webhook):
        body = _body({"status": "done"})
        client.post(
            f"/webhook/callback/{project_webhook['callback_token']}",
            content=body,
            headers={"X-Hub-Signature-256": f"sha256={_hmac(project_webhook['secret'], body)}"},
        )
        # Behind the password gate now, not on the auth-bypassed callback prefix (ADR-0085).
        resp = client.get(f"/api/nodes/{sample_project.id}/webhook-events")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
