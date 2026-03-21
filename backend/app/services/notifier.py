import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models import Task, Project, Integration
from app.services.email_sender import send_email, build_notification_email, is_configured as smtp_configured

logger = logging.getLogger(__name__)


def _compute_progress(project: Project) -> tuple[int, int, float]:
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    return total, done, progress


def _build_headers(integration: Integration) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if integration.secret:
        headers["Authorization"] = f"Bearer {integration.secret}"
    if integration.type == "drone":
        headers["X-Drone-Event"] = "custom"
        headers["X-Drone-Source"] = "todo-platform"
    elif integration.type == "jenkins":
        headers["X-Jenkins-Source"] = "todo-platform"
    return headers


async def fire_notifications(db: Session, task: Task, event: str) -> None:
    project: Project = task.project
    total, done, progress = _compute_progress(project)

    payload = {
        "event": event,
        "project": {
            "id": project.id,
            "name": project.name,
            "status": project.status,
            "progress": progress,
            "total_tasks": total,
            "done_tasks": done,
        },
        "task": {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    integrations = (
        db.query(Integration)
        .filter(
            Integration.active == True,
            Integration.project_id.in_([project.id, None]),
        )
        .all()
    )

    matching = [i for i in integrations if event in i.events]
    if not matching:
        return

    email_integrations = [i for i in matching if i.type == "email"]
    webhook_integrations = [i for i in matching if i.type != "email"]

    # Send email notifications
    for integration in email_integrations:
        if not integration.email_to:
            logger.warning("Email integration %s has no recipients", integration.name)
            continue
        recipients = [addr.strip() for addr in integration.email_to.split(",") if addr.strip()]
        prefix = integration.email_subject_prefix or "[TODO Platform]"
        subject, html = build_notification_email(event, payload, prefix)
        send_email(recipients, subject, html)

    # Send webhook notifications
    if webhook_integrations:
        async with httpx.AsyncClient(timeout=10) as client:
            for integration in webhook_integrations:
                try:
                    resp = await client.post(
                        integration.url,
                        json=payload,
                        headers=_build_headers(integration),
                    )
                    logger.info("Notified %s [%s] → %s", integration.name, integration.type, resp.status_code)
                except Exception as exc:
                    logger.warning("Failed to notify %s: %s", integration.name, exc)


async def fire_test_notification(integration: Integration) -> dict:
    payload = {
        "event": "test",
        "message": "This is a test notification from the TODO platform.",
        "integration": {"id": integration.id, "name": integration.name, "type": integration.type},
        "project": {"name": "Test Project", "progress": 75.0, "total_tasks": 4, "done_tasks": 3},
        "task": {"title": "Test Task", "status": "done", "priority": "high"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if integration.type == "email":
        if not integration.email_to:
            return {"success": False, "error": "No recipients configured"}
        if not smtp_configured():
            return {"success": False, "error": "SMTP not configured (set SMTP_HOST and SMTP_FROM env vars)"}
        recipients = [addr.strip() for addr in integration.email_to.split(",") if addr.strip()]
        prefix = integration.email_subject_prefix or "[TODO Platform]"
        subject, html = build_notification_email("test", payload, prefix)
        ok = send_email(recipients, subject, html)
        return {"success": ok, "recipients": recipients} if ok else {"success": False, "error": "SMTP send failed"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                integration.url,
                json=payload,
                headers=_build_headers(integration),
            )
        return {"success": True, "status_code": resp.status_code, "body": resp.text[:200]}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
