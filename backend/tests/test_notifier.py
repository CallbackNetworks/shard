"""Tests for the notification service."""

import hashlib
import hmac
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models import Integration, Notification, WebhookDelivery
from app.services.notifier import (
    MAX_ATTEMPTS,
    _build_headers,
    _compute_progress,
    _create_notification,
    _dispatch_webhook,
    fire_notifications,
    fire_project_notifications,
    retry_delivery,
)
from tests.factories import make_project, make_task

# ── _compute_progress ────────────────────────────────────────────────────


class TestComputeProgress:
    def test_all_done(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        for s in ("done", "done", "done"):
            db.add(make_task(db, project_id=p.id, title=f"T-{s}", status=s))
        db.flush()
        db.refresh(p)
        total, done, progress = _compute_progress(p, db)
        assert total == 3
        assert done == 3
        assert progress == 100.0

    def test_partial(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        db.add(make_task(db, project_id=p.id, title="T1", status="done"))
        db.add(make_task(db, project_id=p.id, title="T2", status="todo"))
        db.flush()
        db.refresh(p)
        total, done, progress = _compute_progress(p, db)
        assert total == 2
        assert done == 1
        assert progress == 50.0

    def test_empty_project(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        db.refresh(p)
        total, done, progress = _compute_progress(p, db)
        assert total == 0
        assert progress == 0.0


# ── _build_headers ───────────────────────────────────────────────────────


class TestBuildHeaders:
    def test_webhook_hmac_signature(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="Hook", type="webhook", url="https://example.com", secret="mysecret", events=["task.done"], active=True
        )
        db.add(integ)
        db.flush()

        body = b'{"event":"task.done"}'
        headers = _build_headers(integ, body)

        expected_sig = hmac.new(b"mysecret", body, hashlib.sha256).hexdigest()
        assert headers["X-Signature"] == f"sha256={expected_sig}"
        assert headers["X-Hub-Signature-256"] == f"sha256={expected_sig}"

    def test_webhook_no_secret_no_signature(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="Hook", type="webhook", url="https://example.com", secret=None, events=["task.done"], active=True
        )
        db.add(integ)
        db.flush()

        headers = _build_headers(integ, b"{}")
        assert "X-Signature" not in headers

    def test_bearer_auth_default(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="I", type="generic", url="https://example.com", secret="tok123", events=["task.done"], active=True
        )
        db.add(integ)
        db.flush()

        headers = _build_headers(integ)
        assert headers["Authorization"] == "Bearer tok123"

    def test_drone_type_headers(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="D", type="drone", url="https://drone.ci", secret=None, events=["task.done"], active=True
        )
        db.add(integ)
        db.flush()

        headers = _build_headers(integ)
        assert headers["X-Drone-Event"] == "custom"
        assert headers["X-Drone-Source"] == "shard"

    def test_custom_headers_merged(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="C", type="generic", url="https://example.com", secret=None, events=["task.done"], active=True
        )
        integ.custom_headers = {"X-Custom": "value1"}
        db.add(integ)
        db.flush()

        headers = _build_headers(integ)
        assert headers["X-Custom"] == "value1"

    def test_webhook_signature_and_basic_auth_coexist(self, db):
        """Signing and authentication are independent (ADR-0051).

        A "webhook" integration used to short-circuit the auth chain, so configuring
        basic auth on it produced a request with no Authorization header at all.
        """
        integ = Integration(
            name="Hook",
            type="webhook",
            url="https://example.com",
            secret="mysecret",
            events=["task.done"],
            active=True,
            auth_type="basic",
            auth_config={"username": "u", "password": "p"},
        )
        db.add(integ)
        db.flush()

        body = b'{"event":"task.done"}'
        headers = _build_headers(integ, body)

        expected_sig = hmac.new(b"mysecret", body, hashlib.sha256).hexdigest()
        assert headers["X-Signature"] == f"sha256={expected_sig}"
        assert headers["Authorization"] == "Basic dTpw"

    def test_webhook_secret_is_never_sent_as_bearer_token(self, db):
        """For type="webhook" the secret is the HMAC signing key.

        Sending it as a bearer token would hand the receiver the very key it is
        supposed to use to verify us.
        """
        integ = Integration(
            name="Hook",
            type="webhook",
            url="https://example.com",
            secret="mysecret",
            events=["task.done"],
            active=True,
            auth_type="bearer",
        )
        db.add(integ)
        db.flush()

        headers = _build_headers(integ, b"{}")
        assert "X-Signature" in headers
        assert "Authorization" not in headers

    def test_always_has_platform_event_header(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(name="I", type="generic", url="https://example.com", secret=None, events=[], active=True)
        db.add(integ)
        db.flush()

        headers = _build_headers(integ)
        assert headers["X-Shard-Event"] == "notification"


# ── _dispatch_webhook ────────────────────────────────────────────────────


class TestDispatchWebhook:
    @pytest.fixture()
    def integration(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(
            name="Hook", type="webhook", url="https://example.com/hook", secret="s", events=["task.done"], active=True
        )
        db.add(integ)
        db.flush()
        return integ

    @pytest.mark.asyncio
    async def test_success_creates_delivery(self, db, integration):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "OK"
        mock_resp.is_success = True

        with patch("app.services.notifier.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post.return_value = mock_resp
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await _dispatch_webhook(db, integration, "task.done", {"event": "task.done"})

        assert result is True
        delivery = db.query(WebhookDelivery).filter(WebhookDelivery.integration_id == integration.id).first()
        assert delivery is not None
        assert delivery.status == "success"
        assert delivery.status_code == 200
        assert delivery.delivered_at is not None

    @pytest.mark.asyncio
    async def test_failure_creates_failed_delivery_with_retry(self, db, integration):
        with patch("app.services.notifier.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post.side_effect = httpx.ConnectError("Connection refused")
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await _dispatch_webhook(db, integration, "task.done", {"event": "task.done"})

        assert result is False
        delivery = db.query(WebhookDelivery).filter(WebhookDelivery.integration_id == integration.id).first()
        assert delivery.status == "failed"
        assert delivery.next_retry_at is not None
        assert "Connection refused" in delivery.error

    @pytest.mark.asyncio
    async def test_max_attempts_marks_dead(self, db, integration):
        delivery = WebhookDelivery(
            integration_id=integration.id,
            event="task.done",
            payload={},
            request_url=integration.url,
            request_headers={},
            attempt=MAX_ATTEMPTS,
            status="pending",
        )
        db.add(delivery)
        db.flush()

        with patch("app.services.notifier.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post.side_effect = httpx.ReadTimeout("Timeout")
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await _dispatch_webhook(db, integration, "task.done", {}, delivery)

        assert result is False
        assert delivery.status == "dead"
        assert delivery.next_retry_at is None


# ── fire_notifications ───────────────────────────────────────────────────


class TestFireNotifications:
    @pytest.fixture()
    def setup(self, db):
        p = make_project(db, name="Proj")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="Task1", status="done", priority="high")
        db.add(t)
        db.flush()
        db.refresh(p)
        return p, t

    @pytest.mark.asyncio
    async def test_matching_integration_gets_called(self, db, setup):
        p, t = setup
        integ = Integration(
            name="I", type="webhook", url="https://hook.test", events=["task.done"], active=True, project_id=p.id
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = True
            await fire_notifications(db, t, "task.done")

        mock_dispatch.assert_called_once()
        args = mock_dispatch.call_args
        assert args[0][1] == integ
        assert args[0][2] == "task.done"

    @pytest.mark.asyncio
    async def test_non_matching_event_not_called(self, db, setup):
        p, t = setup
        integ = Integration(
            name="I", type="webhook", url="https://hook.test", events=["task.failed"], active=True, project_id=p.id
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            await fire_notifications(db, t, "task.done")

        mock_dispatch.assert_not_called()

    @pytest.mark.asyncio
    async def test_inactive_integration_not_queried(self, db, setup):
        p, t = setup
        integ = Integration(
            name="I", type="webhook", url="https://hook.test", events=["task.done"], active=False, project_id=p.id
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            await fire_notifications(db, t, "task.done")

        mock_dispatch.assert_not_called()

    @pytest.mark.asyncio
    async def test_unscoped_integration_gets_called(self, db, setup):
        # An integration with no project_id listens to every project. Every other test
        # here pins project_id, which is how `project_id IN (:id, NULL)` — never true for
        # a NULL row — went unnoticed and left global integrations dark (ADR-0047).
        p, t = setup
        integ = Integration(
            name="Global", type="webhook", url="https://hook.test", events=["task.done"], active=True, project_id=None
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = True
            await fire_notifications(db, t, "task.done")

        mock_dispatch.assert_called_once()
        assert mock_dispatch.call_args[0][1] == integ

    @pytest.mark.asyncio
    async def test_other_project_integration_not_called(self, db, setup):
        p, t = setup
        other = make_project(db, name="Other")
        db.add(other)
        db.flush()
        integ = Integration(
            name="I", type="webhook", url="https://hook.test", events=["task.done"], active=True, project_id=other.id
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            await fire_notifications(db, t, "task.done")

        mock_dispatch.assert_not_called()

    @pytest.mark.asyncio
    async def test_project_event_payload_has_no_task(self, db, setup):
        # project.created / project.archived have no task to hang off; the payload omits
        # the key rather than inventing a placeholder (ADR-0047).
        p, _ = setup
        integ = Integration(
            name="I",
            type="webhook",
            url="https://hook.test",
            events=["project.created"],
            active=True,
            project_id=p.id,
        )
        db.add(integ)
        db.flush()

        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = True
            await fire_project_notifications(db, p, "project.created")

        payload = mock_dispatch.call_args[0][3]
        assert payload["event"] == "project.created"
        assert payload["project"]["id"] == p.id
        assert "task" not in payload

    @pytest.mark.asyncio
    async def test_creates_in_app_notification(self, db, setup):
        p, t = setup
        # No webhook integrations, but should still create notification
        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock):
            # Need at least one matching integration to not return early
            integ = Integration(
                name="I", type="webhook", url="https://hook.test", events=["task.done"], active=True, project_id=p.id
            )
            db.add(integ)
            db.flush()
            await fire_notifications(db, t, "task.done")

        notif = db.query(Notification).first()
        assert notif is not None
        assert "Task1" in notif.message
        assert notif.type == "task.done"


# ── _create_notification ─────────────────────────────────────────────────


class TestCreateNotification:
    def test_known_event_creates_notification(self, db):
        p = make_project(db, name="Proj")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="Deploy", status="done")
        db.add(t)
        db.flush()

        _create_notification(db, "task.done", t, p)

        notif = db.query(Notification).first()
        assert notif is not None
        assert "Deploy" in notif.message
        assert notif.link == f"/projects/{p.id}"

    def test_unknown_event_skips(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="T", status="todo")
        db.add(t)
        db.flush()

        _create_notification(db, "unknown.event", t, p)

        assert db.query(Notification).count() == 0


# ── retry_delivery ───────────────────────────────────────────────────────


class TestRetryDelivery:
    @pytest.mark.asyncio
    async def test_retry_increments_attempt(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(name="I", type="webhook", url="https://example.com", events=["task.done"], active=True)
        db.add(integ)
        db.flush()

        delivery = WebhookDelivery(
            integration_id=integ.id,
            event="task.done",
            payload={"event": "task.done"},
            request_url=integ.url,
            request_headers={},
            attempt=1,
            status="failed",
        )
        db.add(delivery)
        db.flush()

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "OK"
        mock_resp.is_success = True

        with patch("app.services.notifier.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.post.return_value = mock_resp
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = mock_instance

            result = await retry_delivery(db, delivery)

        assert result is True
        assert delivery.attempt == 2
        assert delivery.status == "success"

    @pytest.mark.asyncio
    async def test_retry_missing_integration_marks_dead(self, db):
        if db.get_bind().dialect.name != "sqlite":
            pytest.skip("orphan rows cannot be created under enforced foreign keys")
        delivery = WebhookDelivery(
            integration_id="nonexistent-id",
            event="task.done",
            payload={},
            request_url="https://example.com",
            request_headers={},
            attempt=1,
            status="failed",
        )
        db.add(delivery)
        db.flush()

        result = await retry_delivery(db, delivery)

        assert result is False
        assert delivery.status == "dead"
        assert "no longer exists" in delivery.error


class TestSourceFiltering:
    """Who caused a change is part of the payload, and part of what you can subscribe to.

    Rule actions now go through the task pipeline, so a rule flipping a task to done
    produces the same ``task.done`` a person would. That is the point, but it means an
    integration needs a way to say "not the automated ones" — a subscription setting
    rather than a policy baked into the notifier (ADR-0048).
    """

    @pytest.fixture()
    def setup(self, db):
        p = make_project(db, name="Proj")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="Task1", status="done", priority="high")
        db.add(t)
        db.flush()
        db.refresh(p)
        return p, t

    @staticmethod
    def _integration(db, project_id, sources):
        integ = Integration(
            name="I",
            type="webhook",
            url="https://hook.test",
            events=["task.done"],
            sources=sources,
            active=True,
            project_id=project_id,
        )
        db.add(integ)
        db.flush()
        return integ

    async def _fire(self, db, task, source):
        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = True
            await fire_notifications(db, task, "task.done", source=source)
        return mock_dispatch

    @pytest.mark.asyncio
    async def test_no_sources_means_every_source(self, db, setup):
        # Pre-ADR-0048 rows have sources NULL and must keep receiving everything.
        p, t = setup
        self._integration(db, p.id, None)
        assert (await self._fire(db, t, "rule")).call_count == 1

    @pytest.mark.asyncio
    async def test_empty_sources_means_every_source(self, db, setup):
        p, t = setup
        self._integration(db, p.id, [])
        assert (await self._fire(db, t, "rule")).call_count == 1

    @pytest.mark.asyncio
    async def test_selected_source_is_delivered(self, db, setup):
        p, t = setup
        self._integration(db, p.id, ["rule"])
        assert (await self._fire(db, t, "rule")).call_count == 1

    @pytest.mark.asyncio
    async def test_unselected_source_is_filtered_out(self, db, setup):
        p, t = setup
        self._integration(db, p.id, ["user"])
        (await self._fire(db, t, "rule")).assert_not_called()

    @pytest.mark.asyncio
    async def test_payload_carries_source_and_actor(self, db, setup):
        p, t = setup
        self._integration(db, p.id, None)
        with patch("app.services.notifier._dispatch_webhook", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = True
            await fire_notifications(db, t, "task.done", source="rule", actor="workflow")
        payload = mock_dispatch.call_args[0][3]
        assert payload["source"] == "rule"
        assert payload["actor"] == "workflow"

    @pytest.mark.asyncio
    async def test_pipeline_source_is_normalized(self, db, setup):
        # The pipeline's own vocabulary is finer-grained than what a subscriber picks
        # from: "bulk" is still a person clicking, so it must arrive as "user".
        p, t = setup
        self._integration(db, p.id, ["user"])
        assert (await self._fire(db, t, "bulk")).call_count == 1
