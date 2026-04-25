import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone, timedelta

import httpx
from sqlalchemy.orm import Session

from app.models import Task, Project, Integration, WebhookDelivery
from app.services.email_sender import send_email, build_notification_email, is_configured as smtp_configured

logger = logging.getLogger(__name__)

# Retry backoff in minutes: attempt 1→2, 2→3, 3→4, 4→5 retries
RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 360]
MAX_ATTEMPTS = len(RETRY_BACKOFF_MINUTES)


def _compute_progress(project: Project) -> tuple[int, int, float]:
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    return total, done, progress


def _build_headers(integration: Integration, body_bytes: bytes | None = None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if integration.type == "webhook":
        # HMAC-SHA256 signature (GitHub-style): X-Signature: sha256=<hex>
        if integration.secret and body_bytes is not None:
            sig = hmac.new(integration.secret.encode(), body_bytes, hashlib.sha256).hexdigest()
            headers["X-Signature"] = f"sha256={sig}"
            headers["X-Hub-Signature-256"] = f"sha256={sig}"
    else:
        if integration.secret:
            headers["Authorization"] = f"Bearer {integration.secret}"
        if integration.type == "drone":
            headers["X-Drone-Event"] = "custom"
            headers["X-Drone-Source"] = "todo-platform"
        elif integration.type == "jenkins":
            headers["X-Jenkins-Source"] = "todo-platform"
    headers["X-Todo-Platform-Event"] = "notification"
    return headers


def _safe_headers_for_log(headers: dict) -> dict:
    """Strip sensitive auth values before logging."""
    return {k: ("***" if k.lower() in ("authorization",) else v) for k, v in headers.items()}


async def _dispatch_webhook(
    db: Session,
    integration: Integration,
    event: str,
    payload: dict,
    delivery: WebhookDelivery | None = None,
) -> bool:
    """Send one webhook request, create/update delivery log, return success."""
    body_bytes = json.dumps(payload, separators=(",", ":")).encode()
    headers = _build_headers(integration, body_bytes)
    now = datetime.now(timezone.utc)

    if delivery is None:
        delivery = WebhookDelivery(
            integration_id=integration.id,
            event=event,
            payload=payload,
            request_url=integration.url,
            request_headers=_safe_headers_for_log(headers),
            attempt=1,
            status="pending",
        )
        db.add(delivery)
        db.flush()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(integration.url, content=body_bytes, headers=headers)
        delivery.status_code = resp.status_code
        delivery.response_body = resp.text[:2048]
        if resp.is_success:
            delivery.status = "success"
            delivery.delivered_at = now
            db.commit()
            logger.info("Notified %s [%s] → %s", integration.name, integration.type, resp.status_code)
            return True
        else:
            raise httpx.HTTPStatusError(
                f"HTTP {resp.status_code}", request=resp.request, response=resp
            )
    except Exception as exc:
        delivery.error = str(exc)[:500]
        if delivery.attempt >= MAX_ATTEMPTS:
            delivery.status = "dead"
            delivery.next_retry_at = None
        else:
            delivery.status = "failed"
            backoff = RETRY_BACKOFF_MINUTES[delivery.attempt - 1]
            delivery.next_retry_at = now + timedelta(minutes=backoff)
        db.commit()
        logger.warning("Failed to notify %s (attempt %d): %s", integration.name, delivery.attempt, exc)
        return False


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

    # Send webhook notifications with delivery logging
    for integration in webhook_integrations:
        await _dispatch_webhook(db, integration, event, payload)


async def retry_delivery(db: Session, delivery: WebhookDelivery) -> bool:
    """Re-send a specific delivery (for manual retry or scheduler retry)."""
    integration = db.query(Integration).filter(Integration.id == delivery.integration_id).first()
    if not integration:
        delivery.status = "dead"
        delivery.error = "Integration no longer exists"
        db.commit()
        return False

    delivery.attempt += 1
    delivery.status = "pending"
    delivery.error = None
    delivery.status_code = None
    delivery.response_body = None
    db.flush()

    return await _dispatch_webhook(db, integration, delivery.event, delivery.payload, delivery)


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
        body_bytes = json.dumps(payload, separators=(",", ":")).encode()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                integration.url,
                content=body_bytes,
                headers=_build_headers(integration, body_bytes),
            )
        return {"success": True, "status_code": resp.status_code, "body": resp.text[:200]}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
