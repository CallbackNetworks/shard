"""Tests for the background scheduler service."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.models import ApiKey, Integration, Node, RecurrenceRule, WebhookDelivery
from app.services.scheduler import (
    _check_and_fire,
    _check_recurring,
    _compute_next_run,
    _ensure_aware,
    _retry_failed_webhooks,
    _send_daily_summary,
)
from tests.factories import make_project, make_task


def _settings(**overrides):
    """Effective runtime settings for patching get_system_settings in tests."""
    base = {"summary_hour": 8, "due_soon_window_hours": 24, "reminder_cooldown_hours": 23}
    base.update(overrides)
    return base


def _now():
    """Return aware UTC datetime matching the app-wide convention."""
    return datetime.now(UTC)


# ── _compute_next_run ────────────────────────────────────────────────────


class TestComputeNextRun:
    def _make_rule(self, db, frequency, **kwargs):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(db, project_id=p.id, title="T", status="todo")
        db.add(t)
        db.flush()
        rule = RecurrenceRule(
            template_task_id=t.id,
            frequency=frequency,
            interval_value=kwargs.get("interval_value", 1),
            day_of_month=kwargs.get("day_of_month"),
            day_of_week=kwargs.get("day_of_week"),
            next_run_at=_now(),
            active=True,
        )
        db.add(rule)
        db.flush()
        return rule

    def test_daily(self, db):
        rule = self._make_rule(db, "daily")
        base = datetime(2026, 3, 15, 10, 0)
        assert _compute_next_run(rule, base) == base + timedelta(days=1)

    def test_weekly(self, db):
        rule = self._make_rule(db, "weekly")
        base = datetime(2026, 3, 15, 10, 0)
        assert _compute_next_run(rule, base) == base + timedelta(weeks=1)

    def test_interval(self, db):
        rule = self._make_rule(db, "interval", interval_value=3)
        base = datetime(2026, 3, 15, 10, 0)
        assert _compute_next_run(rule, base) == base + timedelta(days=3)

    def test_monthly(self, db):
        rule = self._make_rule(db, "monthly", day_of_month=15)
        base = datetime(2026, 1, 15, 10, 0)
        result = _compute_next_run(rule, base)
        assert result.month == 2
        assert result.day == 15

    def test_monthly_clamps_day(self, db):
        rule = self._make_rule(db, "monthly", day_of_month=31)
        base = datetime(2026, 1, 31, 10, 0)
        result = _compute_next_run(rule, base)
        assert result.month == 2
        assert result.day == 28  # Feb 2026 has 28 days

    def test_monthly_december_wraps_to_january(self, db):
        rule = self._make_rule(db, "monthly", day_of_month=15)
        base = datetime(2026, 12, 15, 10, 0)
        result = _compute_next_run(rule, base)
        assert result.year == 2027
        assert result.month == 1
        assert result.day == 15

    def test_unknown_frequency_defaults_daily(self, db):
        # Built in memory (not flushed): databases with native enums reject
        # invalid values at INSERT time, but the fallback branch is pure Python.
        rule = RecurrenceRule(template_task_id="t", frequency="unknown", interval_value=1, active=True)
        base = datetime(2026, 3, 15, 10, 0)
        assert _compute_next_run(rule, base) == base + timedelta(days=1)


# ── _check_and_fire ──────────────────────────────────────────────────────


class TestCheckAndFire:
    @pytest.mark.asyncio
    async def test_fires_due_soon_for_upcoming_task(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(
            db,
            project_id=p.id,
            title="Almost due",
            status="todo",
            due_date=_now() + timedelta(hours=12),
        )
        db.add(t)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_and_fire(db)

        mock_fire.assert_called_once()
        args = mock_fire.call_args[0]
        assert args[2] == "task.due_soon"
        db.refresh(t)
        assert (t.data or {}).get("reminder_sent_at") is not None

    @pytest.mark.asyncio
    async def test_fires_overdue_for_past_due_task(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(
            db,
            project_id=p.id,
            title="Overdue task",
            status="in_progress",
            due_date=_now() - timedelta(hours=1),
        )
        db.add(t)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_and_fire(db)

        mock_fire.assert_called_once()
        assert mock_fire.call_args[0][2] == "task.overdue"

    @pytest.mark.asyncio
    async def test_skips_done_tasks(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(
            db,
            project_id=p.id,
            title="Done task",
            status="done",
            due_date=_now() + timedelta(hours=12),
        )
        db.add(t)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_and_fire(db)

        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_skips_recently_reminded(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(
            db,
            project_id=p.id,
            title="Recently reminded",
            status="todo",
            due_date=_now() + timedelta(hours=12),
            reminder_sent_at=_now() - timedelta(hours=1),
        )
        db.add(t)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_and_fire(db)

        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_re_sends_after_cooldown(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        t = make_task(
            db,
            project_id=p.id,
            title="Old reminder",
            status="todo",
            due_date=_now() + timedelta(hours=12),
            reminder_sent_at=_now() - timedelta(hours=48),
        )
        db.add(t)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_and_fire(db)

        mock_fire.assert_called_once()


# ── _check_recurring ─────────────────────────────────────────────────────


class TestCheckRecurring:
    @pytest.mark.asyncio
    async def test_creates_task_from_template(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(db, project_id=p.id, title="Weekly Report", status="todo", priority="medium")
        db.add(template)
        db.flush()

        rule = RecurrenceRule(
            template_task_id=template.id,
            frequency="weekly",
            next_run_at=_now() - timedelta(minutes=5),
            active=True,
        )
        db.add(rule)
        db.commit()

        await _check_recurring(db)

        new_tasks = (
            db.query(Node).filter(Node.type == "task", Node.title == "Weekly Report", Node.id != template.id).all()
        )
        assert len(new_tasks) == 1
        assert new_tasks[0].status == "todo"
        assert new_tasks[0].priority == "medium"

        db.refresh(rule)
        assert rule.last_run_at is not None
        assert _ensure_aware(rule.next_run_at) > _now()

    @pytest.mark.asyncio
    async def test_generated_task_keeps_the_agent_it_was_assigned_to(self, db):
        """The agent assignment travels with the copy (ADR-0149).

        ``assignee`` was carried and ``assigned_agent_key_id`` was not, so a schedule
        aimed at an agent generated work aimed at nobody -- and because the free-text
        half kept working, nothing about the template looked wrong.
        """
        key = ApiKey(name="agent-b", scopes=["read", "write"], active=True)
        db.add(key)
        db.flush()

        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(
            db,
            project_id=p.id,
            title="Nightly check",
            status="todo",
            assignee="agent-b",
            assigned_agent_key_id=key.id,
        )
        db.add(template)
        db.flush()

        db.add(
            RecurrenceRule(
                template_task_id=template.id,
                frequency="daily",
                next_run_at=_now() - timedelta(minutes=5),
                active=True,
            )
        )
        db.commit()

        await _check_recurring(db)

        generated = db.query(Node).filter(Node.title == "Nightly check", Node.id != template.id).one()
        assert (generated.data or {}).get("assigned_agent_key_id") == key.id
        assert (generated.data or {}).get("assignee") == "agent-b"

    @pytest.mark.asyncio
    async def test_a_revoked_agent_key_is_not_copied_forward(self, db):
        """An id pointing at nothing reads as an assignment on every surface that shows one."""
        key = ApiKey(name="agent-gone", scopes=["read"], active=False)
        db.add(key)
        db.flush()

        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(db, project_id=p.id, title="Stale owner", status="todo", assigned_agent_key_id=key.id)
        db.add(template)
        db.flush()

        db.add(
            RecurrenceRule(
                template_task_id=template.id,
                frequency="daily",
                next_run_at=_now() - timedelta(minutes=5),
                active=True,
            )
        )
        db.commit()

        await _check_recurring(db)

        generated = db.query(Node).filter(Node.title == "Stale owner", Node.id != template.id).one()
        assert (generated.data or {}).get("assigned_agent_key_id") is None

    @pytest.mark.asyncio
    async def test_skips_future_next_run(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(db, project_id=p.id, title="Future", status="todo")
        db.add(template)
        db.flush()

        rule = RecurrenceRule(
            template_task_id=template.id,
            frequency="daily",
            next_run_at=_now() + timedelta(hours=2),
            active=True,
        )
        db.add(rule)
        db.commit()

        await _check_recurring(db)

        count = db.query(Node).filter(Node.type == "task", Node.title == "Future").count()
        assert count == 1  # only the template

    @pytest.mark.asyncio
    async def test_skips_inactive_rule(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(db, project_id=p.id, title="Inactive", status="todo")
        db.add(template)
        db.flush()

        rule = RecurrenceRule(
            template_task_id=template.id,
            frequency="daily",
            next_run_at=_now() - timedelta(minutes=5),
            active=False,
        )
        db.add(rule)
        db.commit()

        await _check_recurring(db)

        count = db.query(Node).filter(Node.type == "task", Node.title == "Inactive").count()
        assert count == 1

    @pytest.mark.asyncio
    async def test_skips_expired_end_date(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        template = make_task(db, project_id=p.id, title="Expired", status="todo")
        db.add(template)
        db.flush()

        rule = RecurrenceRule(
            template_task_id=template.id,
            frequency="daily",
            next_run_at=_now() - timedelta(minutes=5),
            end_date=_now() - timedelta(days=1),
            active=True,
        )
        db.add(rule)
        db.commit()

        await _check_recurring(db)

        count = db.query(Node).filter(Node.type == "task", Node.title == "Expired").count()
        assert count == 1


# ── _retry_failed_webhooks ───────────────────────────────────────────────


class TestRetryFailedWebhooks:
    @pytest.mark.asyncio
    async def test_retries_due_deliveries(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(name="I", type="webhook", url="https://example.com", events=["task.done"], active=True)
        db.add(integ)
        db.flush()

        delivery = WebhookDelivery(
            integration_id=integ.id,
            event="task.done",
            payload={},
            request_url=integ.url,
            request_headers={},
            attempt=1,
            status="failed",
            next_retry_at=_now() - timedelta(minutes=5),
        )
        db.add(delivery)
        db.commit()

        with patch("app.services.scheduler.retry_delivery", new_callable=AsyncMock) as mock_retry:
            mock_retry.return_value = True
            await _retry_failed_webhooks(db)

        mock_retry.assert_called_once()

    @pytest.mark.asyncio
    async def test_skips_future_retry(self, db):
        p = make_project(db, name="P")
        db.add(p)
        db.flush()
        integ = Integration(name="I", type="webhook", url="https://example.com", events=["task.done"], active=True)
        db.add(integ)
        db.flush()

        delivery = WebhookDelivery(
            integration_id=integ.id,
            event="task.done",
            payload={},
            request_url=integ.url,
            request_headers={},
            attempt=1,
            status="failed",
            next_retry_at=_now() + timedelta(hours=1),
        )
        db.add(delivery)
        db.commit()

        with patch("app.services.scheduler.retry_delivery", new_callable=AsyncMock) as mock_retry:
            await _retry_failed_webhooks(db)

        mock_retry.assert_not_called()


# ── _send_daily_summary ──────────────────────────────────────────────────


class TestSendDailySummary:
    @pytest.mark.asyncio
    async def test_sends_once_per_day(self, db):
        p = make_project(db, name="P", status="active")
        db.add(p)
        db.flush()
        integ = Integration(name="Email", type="email", url="", email_to="test@test.com", events=[], active=True)
        db.add(integ)
        db.commit()

        with (
            patch("app.services.scheduler.email_sender") as mock_email,
            patch("app.services.scheduler.get_system_settings", return_value=_settings(summary_hour=0)),
        ):
            mock_email.send_email.return_value = True
            await _send_daily_summary(db)
            first_call_count = mock_email.send_email.call_count

            # Second call same day should not send again
            await _send_daily_summary(db)
            assert mock_email.send_email.call_count == first_call_count

    @pytest.mark.asyncio
    async def test_skips_before_summary_hour(self, db):
        with (
            patch("app.services.scheduler.get_system_settings", return_value=_settings(summary_hour=23)),
            patch("app.services.scheduler.email_sender") as mock_email,
        ):
            # Unless current hour >= 23, it should skip
            now = _now()
            if now.hour < 23:
                await _send_daily_summary(db)
                mock_email.send_email.assert_not_called()
