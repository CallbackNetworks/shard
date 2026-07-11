"""Long-run scheduler behavior driven by a fake clock.

One-shot unit tests cannot catch failures that only appear across day/week
boundaries, restarts, or repeated ticks. These tests compress simulated days
of hourly ticks into milliseconds by patching `scheduler.now_utc`.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

import app.services.scheduler as sched
from app.models import Integration, Project, RecurrenceRule, Task
from app.services.scheduler import (
    _check_and_fire,
    _check_recurring,
    _get_state,
    _run_tick,
    _send_daily_summary,
    _send_weekly_digest,
    get_scheduler_health,
)


class FakeClock:
    def __init__(self, start: datetime):
        self.current = start

    def now(self) -> datetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current += delta


def _full_settings(**overrides):
    base = {
        "summary_hour": 8,
        "due_soon_window_hours": 24,
        "reminder_cooldown_hours": 23,
        "backup_enabled": 0,
        "backup_hour": 3,
        "backup_keep": 7,
    }
    base.update(overrides)
    return base


def _email_setup(db):
    p = Project(name="P", status="active")
    db.add(p)
    db.flush()
    integ = Integration(name="Email", type="email", url="", email_to="me@example.com", events=[], active=True)
    db.add(integ)
    db.commit()
    return p


# 2026-03-02 is a Monday.
MONDAY = datetime(2026, 3, 2, 0, 30, tzinfo=UTC)


class TestDailySummaryLongRun:
    @pytest.mark.asyncio
    async def test_sent_exactly_once_per_day_over_three_days(self, db):
        _email_setup(db)
        clock = FakeClock(MONDAY)

        with (
            patch("app.services.scheduler.now_utc", side_effect=clock.now),
            patch("app.services.scheduler.get_system_settings", return_value=_full_settings()),
            patch("app.services.scheduler.email_sender") as mock_email,
        ):
            mock_email.send_email.return_value = True
            for _ in range(72):  # three days of hourly ticks
                clock.advance(timedelta(hours=1))
                await _send_daily_summary(db)

        assert mock_email.send_email.call_count == 3

    @pytest.mark.asyncio
    async def test_dedup_survives_process_restart(self, db):
        """The once-per-day marker lives in the DB, so a restart cannot resend."""
        _email_setup(db)
        clock = FakeClock(MONDAY.replace(hour=9))

        with (
            patch("app.services.scheduler.now_utc", side_effect=clock.now),
            patch("app.services.scheduler.get_system_settings", return_value=_full_settings()),
            patch("app.services.scheduler.email_sender") as mock_email,
        ):
            mock_email.send_email.return_value = True
            await _send_daily_summary(db)
            assert mock_email.send_email.call_count == 1
            # Restart = new process: module state is gone, only the DB survives.
            # The dedup marker must therefore be in the DB, not a module global.
            assert _get_state(db).get("last_summary_date") == "2026-03-02"
            clock.advance(timedelta(hours=2))
            await _send_daily_summary(db)
            assert mock_email.send_email.call_count == 1


class TestWeeklyDigestLongRun:
    @pytest.mark.asyncio
    async def test_sent_exactly_once_per_week_over_two_weeks(self, db, monkeypatch):
        _email_setup(db)
        monkeypatch.setattr(sched, "DIGEST_DAY", 1)  # Tuesday
        clock = FakeClock(MONDAY)

        with (
            patch("app.services.scheduler.now_utc", side_effect=clock.now),
            patch("app.services.scheduler.get_system_settings", return_value=_full_settings()),
            patch("app.services.scheduler.email_sender") as mock_email,
        ):
            mock_email.send_email.return_value = True
            for _ in range(14 * 24):  # two weeks of hourly ticks
                clock.advance(timedelta(hours=1))
                await _send_weekly_digest(db)

        assert mock_email.send_email.call_count == 2


class TestReminderCadenceLongRun:
    @pytest.mark.asyncio
    async def test_cooldown_produces_expected_resend_cadence(self, db):
        """Over 48 hourly ticks: first reminder when the task enters the
        due-soon window, one resend after the cooldown, nothing else."""
        p = Project(name="P")
        db.add(p)
        db.flush()
        clock = FakeClock(MONDAY)
        t = Task(project_id=p.id, title="Due later", status="todo", due_date=MONDAY + timedelta(hours=30))
        db.add(t)
        db.commit()

        with (
            patch("app.services.scheduler.now_utc", side_effect=clock.now),
            patch("app.services.scheduler.get_system_settings", return_value=_full_settings()),
            patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire,
        ):
            for _ in range(48):
                clock.advance(timedelta(hours=1))
                await _check_and_fire(db)

        events = [c.args[2] for c in mock_fire.call_args_list]
        assert len(events) == 2, f"expected initial reminder + one post-cooldown resend, got {events}"


class TestRecurringLongRun:
    @pytest.mark.asyncio
    async def test_daily_rule_creates_one_task_per_day(self, db):
        p = Project(name="P")
        db.add(p)
        db.flush()
        template = Task(project_id=p.id, title="Daily standup", status="todo")
        db.add(template)
        db.flush()
        rule = RecurrenceRule(template_task_id=template.id, frequency="daily", next_run_at=MONDAY, active=True)
        db.add(rule)
        db.commit()

        clock = FakeClock(MONDAY)
        with patch("app.services.scheduler.now_utc", side_effect=clock.now):
            for _ in range(72):  # three days of hourly ticks
                clock.advance(timedelta(hours=1))
                await _check_recurring(db)

        clones = db.query(Task).filter(Task.title == "Daily standup", Task.id != template.id).count()
        assert clones == 3


class TestTickIsolation:
    @pytest.mark.asyncio
    async def test_failing_check_does_not_starve_the_rest(self, db, monkeypatch):
        """A persistently crashing check must not silently disable the others."""
        p = Project(name="P")
        db.add(p)
        db.flush()
        template = Task(project_id=p.id, title="Survivor", status="todo")
        db.add(template)
        db.flush()
        rule = RecurrenceRule(
            template_task_id=template.id,
            frequency="daily",
            next_run_at=datetime.now(UTC) - timedelta(minutes=5),
            active=True,
        )
        db.add(rule)
        db.commit()

        monkeypatch.setattr(sched, "_check_and_fire", AsyncMock(side_effect=RuntimeError("boom")))
        with patch("app.services.scheduler.get_system_settings", return_value=_full_settings()):
            await _run_tick(db)

        clones = db.query(Task).filter(Task.title == "Survivor", Task.id != template.id).count()
        assert clones == 1, "recurring check should still run after an earlier check crashed"
        assert get_scheduler_health()["alive"] is True


class TestSchedulerHealth:
    @pytest.mark.asyncio
    async def test_reports_dead_when_ticks_stop(self, db, monkeypatch):
        clock = FakeClock(MONDAY)
        monkeypatch.setattr(sched, "_last_tick_at", None)
        assert get_scheduler_health()["alive"] is False

        with (
            patch("app.services.scheduler.now_utc", side_effect=clock.now),
            patch("app.services.scheduler.get_system_settings", return_value=_full_settings()),
        ):
            await _run_tick(db)
            assert get_scheduler_health()["alive"] is True
            # Scheduler silently stops ticking; clock keeps moving.
            clock.advance(timedelta(seconds=sched.CHECK_INTERVAL_SECONDS * 2 + 1))
            health = get_scheduler_health()
            assert health["alive"] is False
            assert health["last_tick_at"] is not None

    def test_health_endpoint_exposes_scheduler_liveness(self, client):
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert "alive" in body["scheduler"]
        assert "last_tick_at" in body["scheduler"]
