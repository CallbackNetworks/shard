"""The delivery log is a second path out for a credential (ADR-0085).

ADR-0063 withholds an integration's ``auth_config`` and ``custom_headers`` when the
integration itself is read. The delivery log then stored the *resulting* request headers
verbatim and served them — the same secret leaving by another door, which is the shape
ADR-0059 and ADR-0063 each found once already.

What makes the redaction here non-obvious is that the secret header names are not a fixed
list. ``auth_type="api_key"`` puts the key in whatever ``auth_config["header_name"]`` says,
and ``custom_headers`` is a free-form dict a user may well have put a token in. So the
names are *derived from the integration*, and these tests are mostly about that derivation
being right for every shape an integration can take.

The second thing pinned here is that redaction is applied on **read**. A log is written
once and read forever; a fix that only touched the writer would leave every historical row
leaking, and no test of the write path would notice.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.models import Integration, WebhookDelivery
from app.services import delivery_admin
from app.services.delivery_admin import REDACTED, public_headers, secret_header_names
from app.services.errors import Invalid, NotFound


def _integration(db, **kwargs):
    row = Integration(
        name=kwargs.pop("name", "target"),
        type=kwargs.pop("type", "webhook"),
        url="https://example.invalid/hook",
        events=["task.done"],
        active=True,
        **kwargs,
    )
    db.add(row)
    db.commit()
    return row


def _delivery(db, integration, **kwargs):
    row = WebhookDelivery(
        integration_id=integration.id if integration else None,
        event=kwargs.pop("event", "task.done"),
        status=kwargs.pop("status", "success"),
        request_url=kwargs.pop("request_url", "https://example.invalid/hook"),
        **kwargs,
    )
    db.add(row)
    db.commit()
    return row


class TestWhichHeadersAreSecret:
    """Derived from the integration, because the user chooses the names."""

    def test_authorization_always_counts(self, db):
        assert "authorization" in secret_header_names(None)

    def test_a_named_api_key_header_counts(self, db):
        integration = _integration(db, auth_type="api_key", auth_config={"header_name": "X-Deploy-Key"})
        assert "x-deploy-key" in secret_header_names(integration)

    def test_the_api_key_header_defaults_when_unnamed(self, db):
        integration = _integration(db, auth_type="api_key", auth_config={})
        assert "x-api-key" in secret_header_names(integration)

    def test_every_custom_header_counts(self, db):
        """Free-form, so it is treated as credential-bearing rather than guessed at."""
        integration = _integration(db, custom_headers={"X-Tenant-Token": "s3cret", "X-Trace": "abc"})
        names = secret_header_names(integration)
        assert {"x-tenant-token", "x-trace"} <= names

    def test_a_bearer_integration_does_not_widen_the_set(self, db):
        integration = _integration(db, auth_type="bearer", auth_config={"token": "t"})
        assert secret_header_names(integration) == {"authorization"}

    def test_matching_is_case_insensitive(self, db):
        integration = _integration(db, auth_type="api_key", auth_config={"header_name": "X-Deploy-Key"})
        headers = {"x-DEPLOY-key": "s3cret", "Content-Type": "application/json"}
        assert public_headers(headers, integration)["x-DEPLOY-key"] == REDACTED


class TestRedactionOnRead:
    def test_a_credential_header_is_blanked(self, db):
        integration = _integration(db, auth_type="api_key", auth_config={"header_name": "X-Deploy-Key"})
        _delivery(db, integration, request_headers={"X-Deploy-Key": "s3cret", "Accept": "application/json"})

        [row] = delivery_admin.list_deliveries(db)
        assert row.request_headers["X-Deploy-Key"] == REDACTED
        assert row.request_headers["Accept"] == "application/json"

    def test_a_row_written_before_the_rule_existed_is_redacted_too(self, db):
        """The point of redacting on read: nothing rewrites history."""
        integration = _integration(db, custom_headers={"X-Tenant-Token": "leaked"})
        _delivery(db, integration, request_headers={"X-Tenant-Token": "leaked"})

        assert (
            delivery_admin.get_delivery(db, delivery_admin.list_deliveries(db)[0].id).request_headers["X-Tenant-Token"]
            == REDACTED
        )

    def test_authorization_is_hidden_even_with_no_integration_to_derive_from(self):
        """`public_headers(..., None)` is the floor the derivation falls back to.

        Not reachable through a stored row — `integration_id` is NOT NULL with
        ON DELETE CASCADE, so a delivery cannot outlive its integration — but
        `_redacted` still calls this path via `by_id.get()` returning None, and the
        floor is what stops that being a leak rather than a KeyError.
        """
        assert public_headers({"Authorization": "Bearer leaked"}, None) == {"Authorization": REDACTED}

    def test_empty_headers_survive(self, db):
        integration = _integration(db)
        _delivery(db, integration, request_headers=None)
        assert delivery_admin.list_deliveries(db)[0].request_headers == {}

    def test_the_single_read_redacts_as_well_as_the_list(self, db):
        integration = _integration(db, auth_type="api_key", auth_config={"header_name": "X-Key"})
        row = _delivery(db, integration, request_headers={"X-Key": "s3cret"})
        assert delivery_admin.get_delivery(db, row.id).request_headers["X-Key"] == REDACTED

    def test_redaction_is_not_written_back(self, db):
        """`_redacted` mutates loaded instances, so a stray commit would destroy the log."""
        integration = _integration(db, auth_type="api_key", auth_config={"header_name": "X-Key"})
        row = _delivery(db, integration, request_headers={"X-Key": "s3cret"})
        delivery_admin.list_deliveries(db)
        db.expire_all()
        assert db.query(WebhookDelivery).filter(WebhookDelivery.id == row.id).first().request_headers == {
            "X-Key": "s3cret"
        }


class TestFiltering:
    @pytest.fixture()
    def populated(self, db):
        integration = _integration(db)
        other = _integration(db, name="other")
        now = datetime.now(UTC)
        _delivery(db, integration, status="success", event="task.done", status_code=200)
        _delivery(db, integration, status="failed", event="task.created", status_code=500)
        _delivery(db, other, status="dead", event="task.done", status_code=404)
        old = _delivery(db, integration, status="success", event="task.done", status_code=200)
        old.created_at = now - timedelta(days=40)
        db.commit()
        return integration, other

    def test_by_integration(self, db, populated):
        integration, _ = populated
        rows = delivery_admin.list_deliveries(db, integration_id=integration.id)
        assert {r.integration_id for r in rows} == {integration.id}

    def test_by_status(self, db, populated):
        assert {r.status for r in delivery_admin.list_deliveries(db, status="failed")} == {"failed"}

    def test_by_event(self, db, populated):
        assert {r.event for r in delivery_admin.list_deliveries(db, event="task.created")} == {"task.created"}

    def test_by_status_code(self, db, populated):
        assert {r.status_code for r in delivery_admin.list_deliveries(db, status_code=500)} == {500}

    def test_by_time_window(self, db, populated):
        recent = delivery_admin.list_deliveries(db, since=datetime.now(UTC) - timedelta(days=1))
        assert len(recent) == 3, "the 40-day-old row should be outside the window"

    def test_limit_and_offset(self, db, populated):
        first = delivery_admin.list_deliveries(db, limit=2, offset=0)
        second = delivery_admin.list_deliveries(db, limit=2, offset=2)
        assert len(first) == 2
        assert not {r.id for r in first} & {r.id for r in second}

    def test_an_unknown_integration_is_refused_when_asked_to_check(self, db):
        with pytest.raises(NotFound):
            delivery_admin.list_deliveries(db, integration_id="nope", require_integration=True)

    def test_an_unknown_integration_is_simply_empty_when_not_asked(self, db):
        assert delivery_admin.list_deliveries(db, integration_id="nope") == []

    def test_an_unknown_delivery_is_refused(self, db):
        with pytest.raises(NotFound):
            delivery_admin.get_delivery(db, "nope")


class TestHealth:
    def test_counts_and_rate(self, db):
        integration = _integration(db)
        for status in ("success", "success", "failed", "dead"):
            _delivery(db, integration, status=status)

        report = delivery_admin.health(db, integration.id)
        assert report["total_deliveries"] == 4
        assert report["successes"] == 2
        assert report["failures"] == 2, "dead counts as a failure"
        assert report["dead"] == 1
        assert report["success_rate"] == 50.0

    def test_an_integration_with_no_deliveries_does_not_divide_by_zero(self, db):
        integration = _integration(db)
        report = delivery_admin.health(db, integration.id)
        assert report["total_deliveries"] == 0
        assert report["success_rate"] == 0.0
        assert report["avg_latency_ms"] is None
        assert report["last_success_at"] is None

    def test_only_the_last_seven_days_count(self, db):
        integration = _integration(db)
        old = _delivery(db, integration, status="success")
        old.created_at = datetime.now(UTC) - timedelta(days=8)
        db.commit()
        assert delivery_admin.health(db, integration.id)["total_deliveries"] == 0

    def test_latency_averages_only_settled_successes(self, db):
        integration = _integration(db)
        now = datetime.now(UTC)
        ok = _delivery(db, integration, status="success")
        ok.created_at, ok.delivered_at = now - timedelta(seconds=2), now
        pending = _delivery(db, integration, status="success")
        pending.delivered_at = None
        db.commit()

        report = delivery_admin.health(db, integration.id)
        assert report["avg_latency_ms"] == pytest.approx(2000, abs=50)

    def test_an_unknown_integration_is_refused(self, db):
        with pytest.raises(NotFound):
            delivery_admin.health(db, "nope")


class TestRetry:
    @pytest.mark.asyncio
    async def test_only_failed_or_dead_can_be_retried(self, db):
        integration = _integration(db)
        row = _delivery(db, integration, status="success")
        with pytest.raises(Invalid):
            await delivery_admin.retry(db, row.id)

    @pytest.mark.asyncio
    async def test_an_unknown_delivery_is_refused(self, db):
        with pytest.raises(NotFound):
            await delivery_admin.retry(db, "nope")

    @pytest.mark.asyncio
    async def test_retry_all_refuses_an_unknown_integration(self, db):
        with pytest.raises(NotFound):
            await delivery_admin.retry_all(db, "nope")


class TestPurge:
    def test_removes_only_rows_past_the_cutoff(self, db):
        integration = _integration(db)
        keep = _delivery(db, integration)
        drop = _delivery(db, integration)
        drop.created_at = datetime.now(UTC) - timedelta(days=40)
        db.commit()

        keep_id, drop_id = keep.id, drop.id
        delivery_admin.purge(db, older_than_days=30)

        remaining = {r.id for r in db.query(WebhookDelivery).all()}
        assert keep_id in remaining
        assert drop_id not in remaining

    def test_can_be_narrowed_to_one_status(self, db):
        integration = _integration(db)
        old_success = _delivery(db, integration, status="success")
        old_failed = _delivery(db, integration, status="failed")
        for row in (old_success, old_failed):
            row.created_at = datetime.now(UTC) - timedelta(days=40)
        db.commit()

        success_id, failed_id = old_success.id, old_failed.id
        delivery_admin.purge(db, older_than_days=30, status="failed")

        remaining = {r.id for r in db.query(WebhookDelivery).all()}
        assert success_id in remaining
        assert failed_id not in remaining
