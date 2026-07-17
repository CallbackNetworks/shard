"""Tests for SLA / aging alert scheduler feature."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.models import ActivityLog, Node, Project
from app.services.scheduler import _check_sla_aging
from tests.factories import make_task


def _now():
    """Return naive UTC datetime matching what SQLite stores."""
    return datetime.utcnow()


def _make_project(db, name="SLA Project"):
    p = Project(name=name)
    db.add(p)
    db.flush()
    return p


def _make_task(db, project_id, title, status="in_progress", priority="medium", days_ago=0):
    """Create a task with updated_at backdated by days_ago."""
    t = make_task(db, project_id=project_id, title=title, status=status, priority=priority)
    db.add(t)
    db.flush()
    if days_ago > 0:
        backdated = _now() - timedelta(days=days_ago)
        db.execute(Node.__table__.update().where(Node.__table__.c.id == t.id).values(updated_at=backdated))
        db.commit()
        db.refresh(t)
    return t


class TestSLAEscalation:
    @pytest.mark.asyncio
    async def test_task_stuck_4_days_escalated_to_high(self, db):
        """Task stuck in_progress for 4 days -> priority escalated to high."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Stuck task", status="in_progress", priority="medium", days_ago=4)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock):
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "high"

        # Should have activity log
        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.task_id == t.id, ActivityLog.action == "task.sla_escalated")
            .first()
        )
        assert log is not None
        assert log.meta["days_stuck"] == 4
        assert log.meta["old_priority"] == "medium"

    @pytest.mark.asyncio
    async def test_task_already_high_not_re_escalated(self, db):
        """Task already at high priority and stuck < 7 days -> no re-escalation."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Already high", status="in_progress", priority="high", days_ago=4)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "high"

        # No activity log since it's already high and < 7 days
        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.task_id == t.id, ActivityLog.action == "task.sla_escalated")
            .first()
        )
        assert log is None
        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_task_stuck_8_days_notification_fired(self, db):
        """Task stuck 8 days at high priority -> overdue notification fired."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Long stuck", status="in_progress", priority="high", days_ago=8)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        mock_fire.assert_called_once()
        args = mock_fire.call_args[0]
        assert args[2] == "task.overdue"

        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.task_id == t.id, ActivityLog.action == "task.sla_escalated")
            .first()
        )
        assert log is not None
        assert log.meta["days_stuck"] == 8

    @pytest.mark.asyncio
    async def test_todo_status_not_affected(self, db):
        """Task in 'todo' status should not be escalated."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Todo task", status="todo", priority="low", days_ago=10)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "low"
        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_done_status_not_affected(self, db):
        """Task in 'done' status should not be escalated."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Done task", status="done", priority="low", days_ago=10)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "low"
        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_recently_escalated_not_re_escalated(self, db):
        """Task that was escalated within 7 days should not be re-escalated."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Recently escalated", status="in_progress", priority="medium", days_ago=5)
        db.commit()

        # Simulate a recent escalation log
        recent_log = ActivityLog(
            project_id=p.id,
            task_id=t.id,
            action="task.sla_escalated",
            actor="scheduler",
            detail="Already escalated",
            meta={"days_stuck": 4, "old_priority": "low"},
        )
        db.add(recent_log)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        db.refresh(t)
        # Priority should remain unchanged because of recent escalation
        assert t.priority == "medium"
        mock_fire.assert_not_called()

    @pytest.mark.asyncio
    async def test_low_priority_escalated_to_high(self, db):
        """Low priority task stuck 4 days -> escalated to high."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Low prio", status="in_progress", priority="low", days_ago=4)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock):
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "high"

        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.task_id == t.id, ActivityLog.action == "task.sla_escalated")
            .first()
        )
        assert log.meta["old_priority"] == "low"

    @pytest.mark.asyncio
    async def test_task_stuck_less_than_3_days_not_escalated(self, db):
        """Task stuck only 2 days should not be escalated."""
        p = _make_project(db)
        t = _make_task(db, p.id, "Recent task", status="in_progress", priority="medium", days_ago=2)
        db.commit()

        with patch("app.services.scheduler.fire_notifications", new_callable=AsyncMock) as mock_fire:
            await _check_sla_aging(db)

        db.refresh(t)
        assert t.priority == "medium"
        mock_fire.assert_not_called()
