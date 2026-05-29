"""
Background scheduler — due date reminders + recurring task generation + daily summary.
Runs as an asyncio task in the FastAPI lifespan. Ticks every hour.
"""

import asyncio
import logging
import os
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Integration, Project, RecurrenceRule, Task, WebhookDelivery
from app.services import email_sender
from app.services.activity import log_activity
from app.services.notifier import fire_notifications, retry_delivery

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 3600  # every hour
DUE_SOON_WINDOW_HOURS = 24  # fire "due_soon" when task is due within this many hours
REMINDER_COOLDOWN_HOURS = 23  # don't re-send a reminder within this window


async def _check_and_fire(db: Session) -> None:
    now = datetime.now(UTC)
    due_soon_cutoff = now + timedelta(hours=DUE_SOON_WINDOW_HOURS)
    cooldown_cutoff = now - timedelta(hours=REMINDER_COOLDOWN_HOURS)

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
    now = datetime.now(UTC)
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
    now = datetime.now(UTC)
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


SUMMARY_HOUR = int(os.getenv("SUMMARY_HOUR", "8"))  # Send daily summary at this hour (UTC)
_last_summary_date: str | None = None


async def _send_daily_summary(db: Session) -> None:
    """Generate and send a daily summary email to all email-type integrations."""
    global _last_summary_date
    now = datetime.now(UTC)
    today_str = now.strftime("%Y-%m-%d")

    # Only send once per day, at or after the configured hour
    if _last_summary_date == today_str or now.hour < SUMMARY_HOUR:
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
        <h2 style="margin: 0; font-size: 18px;">Daily Summary — {now.strftime('%B %d, %Y')}</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <h3 style="color: #374151; margin: 0 0 8px;">Projects</h3>
        <ul style="margin: 0 0 16px; padding-left: 20px; color: #4b5563;">{''.join(project_summaries)}</ul>

        {"<h3 style='color: #dc2626; margin: 0 0 8px;'>⚠ Overdue (" + str(len(overdue_tasks)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #dc2626;'>" + ''.join(overdue_items) + "</ul>" if overdue_items else ""}

        {"<h3 style='color: #d97706; margin: 0 0 8px;'>Due Today (" + str(len(due_today)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #92400e;'>" + ''.join(due_today_items) + "</ul>" if due_today_items else ""}

        {"<h3 style='color: #2563eb; margin: 0 0 8px;'>In Progress (" + str(len(in_progress)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + ''.join(in_progress_items) + "</ul>" if in_progress_items else ""}

        {"<h3 style='color: #16a34a; margin: 0 0 8px;'>Completed Yesterday (" + str(len(completed_yesterday)) + ")</h3><ul style='margin: 0 0 16px; padding-left: 20px; color: #4b5563;'>" + ''.join(completed_items) + "</ul>" if completed_items else "<p style='color: #9ca3af; font-size: 13px;'>No tasks completed yesterday.</p>"}
      </div>
      <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 16px;">Sent by TODO Platform</p>
    </div>
    """

    subject = f"[TODO Platform] Daily Summary — {now.strftime('%b %d')}"

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
        except Exception as exc:
            logger.error("Scheduler error: %s", exc)
        finally:
            db.close()
