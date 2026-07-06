"""
Background scheduler — due date reminders + recurring task generation + daily summary.
Runs as an asyncio task in the FastAPI lifespan. Ticks every hour.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import ActivityLog, Integration, Project, RecurrenceRule, Task, WebhookDelivery
from app.services import backup as backup_service
from app.services import email_sender
from app.services.activity import log_activity
from app.services.notifier import fire_notifications, retry_delivery
from app.services.runtime_settings import get_system_settings

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 3600  # every hour


async def _check_and_fire(db: Session) -> None:
    settings = get_system_settings(db)
    now = datetime.utcnow()
    due_soon_cutoff = now + timedelta(hours=settings["due_soon_window_hours"])
    cooldown_cutoff = now - timedelta(hours=settings["reminder_cooldown_hours"])

    tasks = (
        db.query(Task)
        .filter(
            Task.due_date != None,
            Task.status.notin_(["done", "failed"]),
            Task.due_date <= due_soon_cutoff,
            (Task.reminder_sent_at == None) | (Task.reminder_sent_at < cooldown_cutoff),
        )
        .all()
    )

    for task in tasks:
        event = "task.overdue" if task.due_date < now else "task.due_soon"
        try:
            await fire_notifications(db, task, event)
            task.reminder_sent_at = now
            db.commit()
            logger.info("Sent %s reminder for task '%s'", event, task.title)
        except Exception as exc:
            logger.warning("Failed to fire %s for task %s: %s", event, task.id, exc)


def _compute_next_run(rule: RecurrenceRule, from_time: datetime) -> datetime:
    """Compute the next scheduled run after from_time."""
    if rule.frequency == "daily":
        return from_time + timedelta(days=1)
    elif rule.frequency == "interval":
        return from_time + timedelta(days=rule.interval_value)
    elif rule.frequency == "weekly":
        return from_time + timedelta(weeks=1)
    elif rule.frequency == "monthly":
        # Advance by roughly one month
        month = from_time.month + 1
        year = from_time.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        day = rule.day_of_month or from_time.day
        import calendar

        max_day = calendar.monthrange(year, month)[1]
        day = min(day, max_day)
        return from_time.replace(year=year, month=month, day=day)
    return from_time + timedelta(days=1)


async def _check_recurring(db: Session) -> None:
    now = datetime.utcnow()
    rules = (
        db.query(RecurrenceRule)
        .filter(
            RecurrenceRule.active == True,
            RecurrenceRule.next_run_at <= now,
        )
        .all()
    )

    for rule in rules:
        # Skip if past end_date
        if rule.end_date and now > rule.end_date:
            logger.debug("Skipping expired recurrence rule %s", rule.id)
            continue

        template = rule.template_task
        if not template:
            continue

        try:
            # Clone the template task
            new_task = Task(
                id=str(uuid.uuid4()),
                project_id=template.project_id,
                parent_id=None,
                title=template.title,
                description=template.description,
                status="todo",
                priority=template.priority,
                assignee=template.assignee,
                callback_token=str(uuid.uuid4()),
            )
            db.add(new_task)
            db.flush()

            rule.last_run_at = now
            rule.next_run_at = _compute_next_run(rule, now)
            db.commit()

            log_activity(
                db,
                action="task.recurred",
                project_id=template.project_id,
                task_id=new_task.id,
                actor="scheduler",
                detail=f"Recurring task created from template '{template.title}'",
                meta={"template_task_id": template.id, "rule_id": rule.id},
            )
            logger.info("Created recurring task '%s' from template %s", new_task.title, template.id)
        except Exception as exc:
            logger.warning("Failed to process recurrence rule %s: %s", rule.id, exc)
            db.rollback()


async def _retry_failed_webhooks(db: Session) -> None:
    now = datetime.utcnow()
    deliveries = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.status == "failed",
            WebhookDelivery.next_retry_at <= now,
        )
        .all()
    )
    for delivery in deliveries:
        try:
            await retry_delivery(db, delivery)
        except Exception as exc:
            logger.warning("Retry failed for delivery %s: %s", delivery.id, exc)


DIGEST_DAY = int(os.getenv("DIGEST_DAY", "1"))  # Day of week for weekly digest (0=Mon, 6=Sun), default Monday
_last_summary_date: str | None = None
_last_backup_date: str | None = None
_last_weekly_digest_date: str | None = None


async def _run_daily_backup(db: Session) -> None:
    """Write a full backup archive once per day at/after the configured hour."""
    global _last_backup_date
    now = datetime.utcnow()
    today_str = now.strftime("%Y-%m-%d")
    settings = get_system_settings(db)
    if not settings["backup_enabled"] or _last_backup_date == today_str or now.hour < settings["backup_hour"]:
        return
    _last_backup_date = today_str
    try:
        backup_service.write_backup(db)
        backup_service.prune_backups(settings["backup_keep"])
    except Exception as exc:
        logger.error("Daily backup failed: %s", exc)


async def _send_daily_summary(db: Session) -> None:
    """Generate and send a daily summary email to all email-type integrations."""
    global _last_summary_date
    now = datetime.utcnow()
    today_str = now.strftime("%Y-%m-%d")
    summary_hour = get_system_settings(db)["summary_hour"]

    # Only send once per day, at or after the configured hour
    if _last_summary_date == today_str or now.hour < summary_hour:
        return
    _last_summary_date = today_str

    # Gather data
    projects = db.query(Project).filter(Project.status == "active").all()
    if not projects:
        return

    overdue_tasks = (
        db.query(Task)
        .filter(
            Task.due_date < now,
            Task.status.notin_(["done", "failed"]),
        )
        .all()
    )

    due_today = (
        db.query(Task)
        .filter(
            Task.due_date >= now.replace(hour=0, minute=0, second=0),
            Task.due_date <= now.replace(hour=23, minute=59, second=59),
            Task.status.notin_(["done", "failed"]),
        )
        .all()
    )

    in_progress = db.query(Task).filter(Task.status == "in_progress", Task.parent_id == None).all()

    # Yesterday's completions
    yesterday = now - timedelta(days=1)
    completed_yesterday = (
        db.query(Task)
        .filter(
            Task.status == "done",
            Task.updated_at >= yesterday.replace(hour=0, minute=0, second=0),
            Task.updated_at <= yesterday.replace(hour=23, minute=59, second=59),
        )
        .all()
    )

    # Build summary
    project_summaries = []
    for p in projects:
        total = sum(1 for t in p.tasks if t.parent_id is None)
        done = sum(1 for t in p.tasks if t.status == "done" and t.parent_id is None)
        pct = round(done / total * 100) if total else 0
        project_summaries.append(f"<li><strong>{p.name}</strong>: {done}/{total} done ({pct}%)</li>")

    overdue_items = [f"<li>{t.title} (due {t.due_date.strftime('%b %d')})</li>" for t in overdue_tasks[:10]]
    due_today_items = [f"<li>{t.title}</li>" for t in due_today[:10]]
    in_progress_items = [f"<li>{t.title}</li>" for t in in_progress[:10]]
    completed_items = [f"<li>{t.title}</li>" for t in completed_yesterday[:10]]

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #5e6ad2; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Daily Summary — {now.strftime("%B %d, %Y")}</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h3 style="color: #374151; margin: 0 0 8px;">Projects</h3>
        <ul style="margin: 0 0 16px; padding-left: 20px; color: #4b5563;">{"".join(project_summaries)}</ul>

        {"<h3 style='color: #dc2626; margin: 0 0 8px;'>⚠ Overdue (" + str(len(overdue_tasks)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #dc2626;'>" + "".join(overdue_items) + "</ul>" if overdue_items else ""}

        {"<h3 style='color: #d97706; margin: 0 0 8px;'>Due Today (" + str(len(due_today)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #92400e;'>" + "".join(due_today_items) + "</ul>" if due_today_items else ""}

        {"<h3 style='color: #2563eb; margin: 0 0 8px;'>In Progress (" + str(len(in_progress)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + "".join(in_progress_items) + "</ul>" if in_progress_items else ""}

        {"<h3 style='color: #16a34a; margin: 0 0 8px;'>Completed Yesterday (" + str(len(completed_yesterday)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + "".join(completed_items) + "</ul>" if completed_items else "<p style='color: #9ca3af; font-size: 13px;'>No tasks completed yesterday.</p>"}
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">Sent by Shard</p>
    </div>
    """

    subject = f"[Shard] Daily Summary — {now.strftime('%b %d')}"

    # Send to all email-type integrations
    integrations = (
        db.query(Integration)
        .filter(
            Integration.type == "email",
            Integration.active == True,
        )
        .all()
    )

    for intg in integrations:
        to_addrs = [addr.strip() for addr in (intg.email_to or "").split(",") if addr.strip()]
        if to_addrs:
            email_sender.send_email(to_addrs, subject, html)
            logger.info("Sent daily summary to %s", to_addrs)


async def _send_weekly_digest(db: Session) -> None:
    """Generate and send a weekly digest email to all email-type integrations."""
    global _last_weekly_digest_date
    now = datetime.utcnow()
    summary_hour = get_system_settings(db)["summary_hour"]

    # Only send on the configured day of the week, at or after the summary hour
    if now.weekday() != DIGEST_DAY or now.hour < summary_hour:
        return

    # Use ISO week identifier to ensure we only send once per week
    week_str = now.strftime("%Y-W%W")
    if _last_weekly_digest_date == week_str:
        return
    _last_weekly_digest_date = week_str

    # Gather data for the past 7 days
    week_ago = now - timedelta(days=7)

    projects = db.query(Project).filter(Project.status == "active").all()
    if not projects:
        return

    # Tasks completed this week
    completed_this_week = (
        db.query(Task)
        .filter(
            Task.status == "done",
            Task.updated_at >= week_ago,
        )
        .all()
    )

    # Tasks created this week
    created_this_week = (
        db.query(Task)
        .filter(
            Task.created_at >= week_ago,
            Task.parent_id == None,
        )
        .all()
    )

    # Overdue count
    overdue_tasks = (
        db.query(Task)
        .filter(
            Task.due_date < now,
            Task.status.notin_(["done", "failed"]),
        )
        .all()
    )

    # Per-project progress bars and activity tracking
    project_rows = []
    project_activity = []
    for p in projects:
        total = sum(1 for t in p.tasks if t.parent_id is None)
        done = sum(1 for t in p.tasks if t.status == "done" and t.parent_id is None)
        pct = round(done / total * 100) if total else 0
        # Text-based progress bar: 20 chars wide
        filled = round(pct / 5)
        bar = "=" * filled + "-" * (20 - filled)
        project_rows.append(
            f"<tr><td style='padding: 6px 12px;'><strong>{p.name}</strong></td>"
            f"<td style='padding: 6px 12px; font-family: monospace;'>[{bar}]</td>"
            f"<td style='padding: 6px 12px;'>{pct}% ({done}/{total})</td></tr>"
        )
        # Count task changes this week for top-5 ranking
        created_count = sum(1 for t in created_this_week if t.project_id == p.id)
        completed_count = sum(1 for t in completed_this_week if t.project_id == p.id)
        change_count = created_count + completed_count
        if change_count > 0:
            project_activity.append((p.name, change_count, created_count, completed_count))

    # Top 5 most active projects
    project_activity.sort(key=lambda x: x[1], reverse=True)
    top_active = project_activity[:5]

    top_active_rows = []
    for name, _total_changes, created, completed in top_active:
        top_active_rows.append(f"<li><strong>{name}</strong> &mdash; {created} created, {completed} completed</li>")

    completed_items = [f"<li>{t.title}</li>" for t in completed_this_week[:15]]
    created_items = [f"<li>{t.title}</li>" for t in created_this_week[:15]]

    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #4338ca; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Weekly Digest — {(now - timedelta(days=7)).strftime("%b %d")} to {now.strftime("%b %d, %Y")}</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">

        <h3 style="color: #374151; margin: 0 0 8px;">Week at a Glance</h3>
        <table style="width: 100%; margin: 0 0 16px; font-size: 14px; color: #4b5563;">
          <tr>
            <td style="padding: 4px 0;"><strong>{len(completed_this_week)}</strong> tasks completed</td>
            <td style="padding: 4px 0;"><strong>{len(created_this_week)}</strong> tasks created</td>
            <td style="padding: 4px 0; color: #dc2626;"><strong>{len(overdue_tasks)}</strong> overdue</td>
          </tr>
        </table>

        <h3 style="color: #374151; margin: 0 0 8px;">Project Progress</h3>
        <table style="width: 100%; margin: 0 0 16px; font-size: 13px; color: #4b5563; border-collapse: collapse;">
          {"".join(project_rows)}
        </table>

        {"<h3 style='color: #2563eb; margin: 0 0 8px;'>Most Active Projects</h3><ol style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + "".join(top_active_rows) + "</ol>" if top_active_rows else ""}

        {"<h3 style='color: #16a34a; margin: 0 0 8px;'>Completed This Week (" + str(len(completed_this_week)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + "".join(completed_items) + "</ul>" if completed_items else "<p style='color: #9ca3af; font-size: 13px;'>No tasks completed this week.</p>"}

        {"<h3 style='color: #6366f1; margin: 0 0 8px;'>Created This Week (" + str(len(created_this_week)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + "".join(created_items) + "</ul>" if created_items else ""}
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">Sent by Shard</p>
    </div>
    """

    subject = f"[Shard] Weekly Digest — {(now - timedelta(days=7)).strftime('%b %d')} to {now.strftime('%b %d')}"

    # Send to all email-type integrations
    integrations = (
        db.query(Integration)
        .filter(
            Integration.type == "email",
            Integration.active == True,
        )
        .all()
    )

    for intg in integrations:
        to_addrs = [addr.strip() for addr in (intg.email_to or "").split(",") if addr.strip()]
        if to_addrs:
            email_sender.send_email(to_addrs, subject, html)
            logger.info("Sent weekly digest to %s", to_addrs)


SLA_ESCALATION_DAYS = 3  # escalate priority after this many days stuck in_progress
SLA_NOTIFICATION_DAYS = 7  # fire overdue notification after this many days stuck


async def _check_sla_aging(db: Session) -> None:
    """Escalate tasks stuck in 'in_progress' status for too long.

    - > 3 days: upgrade priority to 'high' (if not already)
    - > 7 days: fire a 'task.overdue' notification
    - Skip tasks already escalated within the last 7 days.
    """
    now = datetime.utcnow()
    escalation_cutoff = now - timedelta(days=SLA_ESCALATION_DAYS)

    # Find tasks stuck in_progress
    stuck_tasks = (
        db.query(Task)
        .filter(
            Task.status == "in_progress",
            Task.updated_at <= escalation_cutoff,
        )
        .all()
    )

    for task in stuck_tasks:
        days_stuck = (now - task.updated_at).days

        # Check if already escalated within the last 7 days
        recent_escalation = (
            db.query(ActivityLog)
            .filter(
                ActivityLog.task_id == task.id,
                ActivityLog.action == "task.sla_escalated",
                ActivityLog.created_at >= now - timedelta(days=7),
            )
            .first()
        )
        if recent_escalation:
            continue

        old_priority = task.priority

        # Escalate priority to high if not already
        if task.priority != "high":
            task.priority = "high"
            db.flush()

            log_activity(
                db,
                action="task.sla_escalated",
                project_id=task.project_id,
                task_id=task.id,
                actor="scheduler",
                detail=f"Priority escalated from '{old_priority}' to 'high' (stuck {days_stuck} days)",
                meta={"days_stuck": days_stuck, "old_priority": old_priority},
            )
            db.commit()
            logger.info(
                "SLA escalated task '%s' from %s to high (%d days stuck)",
                task.title,
                old_priority,
                days_stuck,
            )
        elif days_stuck >= SLA_NOTIFICATION_DAYS:
            # Already high priority but stuck too long — fire notification
            log_activity(
                db,
                action="task.sla_escalated",
                project_id=task.project_id,
                task_id=task.id,
                actor="scheduler",
                detail=f"Task stuck for {days_stuck} days, notification fired",
                meta={"days_stuck": days_stuck, "old_priority": old_priority},
            )
            db.commit()

            try:
                await fire_notifications(db, task, "task.overdue")
                logger.info("SLA overdue notification fired for task '%s' (%d days stuck)", task.title, days_stuck)
            except Exception as exc:
                logger.warning("Failed to fire SLA notification for task %s: %s", task.id, exc)


async def due_date_reminder_loop() -> None:
    """Long-running asyncio task. Ticks every hour for reminders, recurring tasks, webhook retries, and daily summary."""
    logger.info("Scheduler started (interval=%ds)", CHECK_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
        db: Session = SessionLocal()
        try:
            await _check_and_fire(db)
            await _check_recurring(db)
            await _retry_failed_webhooks(db)
            await _send_daily_summary(db)
            await _send_weekly_digest(db)
            await _check_sla_aging(db)
            await _run_daily_backup(db)
        except Exception as exc:
            logger.error("Scheduler error: %s", exc)
        finally:
            db.close()
