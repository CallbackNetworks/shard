import asyncio
import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.models import Integration, Notification, Project, Task, WebhookDelivery
from app.services import graph
from app.services.email_sender import build_notification_email, send_email
from app.services.email_sender import is_configured as smtp_configured
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

# Retry backoff in minutes: attempt 1→2, 2→3, 3→4, 4→5 retries
RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 360]
MAX_ATTEMPTS = len(RETRY_BACKOFF_MINUTES)


def _compute_progress(project: Project, db: Session) -> tuple[int, int, float]:
    tasks = graph.tasks_in_project(db, project.id)
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    return total, done, progress


def _build_headers(integration: Integration, body_bytes: bytes | None = None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}

    # Authentication based on auth_type (new) or legacy type-based logic
    auth_type = getattr(integration, "auth_type", None) or "bearer"
    auth_config = getattr(integration, "auth_config", None) or {}

    if integration.type == "webhook":
        # HMAC-SHA256 signature (GitHub-style): X-Signature: sha256=<hex>
        if integration.secret and body_bytes is not None:
            sig = hmac.new(integration.secret.encode(), body_bytes, hashlib.sha256).hexdigest()
            headers["X-Signature"] = f"sha256={sig}"
            headers["X-Hub-Signature-256"] = f"sha256={sig}"
    elif auth_type == "basic":
        # Basic auth from auth_config: {"username": "...", "password": "..."}
        import base64

        username = auth_config.get("username", "")
        password = auth_config.get("password", "") or integration.secret or ""
        creds = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"
    elif auth_type == "api_key":
        # API key: configurable header name and value
        header_name = auth_config.get("header_name", "X-API-Key")
        header_value = auth_config.get("header_value", "") or integration.secret or ""
        headers[header_name] = header_value
    elif auth_type == "none":
        pass  # No auth
    else:
        # Default: bearer token (legacy behavior)
        if integration.secret:
            headers["Authorization"] = f"Bearer {integration.secret}"

    # Type-specific headers
    if integration.type == "drone":
        headers["X-Drone-Event"] = "custom"
        headers["X-Drone-Source"] = "shard"
    elif integration.type == "jenkins":
        headers["X-Jenkins-Source"] = "shard"
    elif integration.type == "github":
        headers["X-GitHub-Source"] = "shard"
    elif integration.type == "gitlab":
        headers["X-GitLab-Source"] = "shard"

    # Custom headers (user-defined key-value pairs)
    custom_headers = getattr(integration, "custom_headers", None)
    if custom_headers and isinstance(custom_headers, dict):
        for key, value in custom_headers.items():
            headers[str(key)] = str(value)

    headers["X-Shard-Event"] = "notification"
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
    background: bool = False,
) -> bool:
    """Send one webhook request, create/update delivery log, return success.

    If background=True, the HTTP call is fired as an asyncio task that uses
    its own DB session, so the caller's request is not blocked by slow targets.
    """
    body_bytes = json.dumps(payload, separators=(",", ":")).encode()
    headers = _build_headers(integration, body_bytes)

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

    if background:
        delivery_id = delivery.id
        url = integration.url
        name = integration.name
        itype = integration.type
        attempt = delivery.attempt
        db.commit()
        asyncio.create_task(_send_webhook_background(delivery_id, url, body_bytes, headers, name, itype, attempt))
        return True

    return await _send_webhook_inline(db, delivery, integration, body_bytes, headers)


async def _send_webhook_background(
    delivery_id: str,
    url: str,
    body_bytes: bytes,
    headers: dict,
    name: str,
    itype: str,
    attempt: int,
) -> None:
    """Execute webhook HTTP call in background with its own DB session."""
    from app.database import SessionLocal

    now = datetime.now(UTC)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, content=body_bytes, headers=headers)

        with SessionLocal() as bg_db:
            delivery = bg_db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
            if not delivery:
                return
            delivery.status_code = resp.status_code
            delivery.response_body = resp.text[:2048]
            if resp.is_success:
                delivery.status = "success"
                delivery.delivered_at = now
                logger.info("Notified %s [%s] → %s", name, itype, resp.status_code)
            else:
                delivery.error = f"HTTP {resp.status_code}"
                if delivery.attempt >= MAX_ATTEMPTS:
                    delivery.status = "dead"
                    delivery.next_retry_at = None
                else:
                    delivery.status = "failed"
                    backoff = RETRY_BACKOFF_MINUTES[delivery.attempt - 1]
                    delivery.next_retry_at = now + timedelta(minutes=backoff)
                logger.warning("Failed to notify %s (attempt %d): HTTP %s", name, attempt, resp.status_code)
            bg_db.commit()
    except httpx.HTTPError as exc:
        with SessionLocal() as bg_db:
            delivery = bg_db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
            if not delivery:
                return
            delivery.error = str(exc)[:500]
            if delivery.attempt >= MAX_ATTEMPTS:
                delivery.status = "dead"
                delivery.next_retry_at = None
            else:
                delivery.status = "failed"
                backoff = RETRY_BACKOFF_MINUTES[delivery.attempt - 1]
                delivery.next_retry_at = now + timedelta(minutes=backoff)
            bg_db.commit()
        logger.warning("Failed to notify %s (attempt %d): %s", name, attempt, exc)
    except Exception as exc:
        logger.error("Unexpected error dispatching webhook to %s: %s", name, exc)


async def _send_webhook_inline(
    db: Session,
    delivery: WebhookDelivery,
    integration: Integration,
    body_bytes: bytes,
    headers: dict,
) -> bool:
    """Execute webhook HTTP call inline (used for test/retry where caller needs result)."""
    now = datetime.now(UTC)
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
            raise httpx.HTTPStatusError(f"HTTP {resp.status_code}", request=resp.request, response=resp)
    except httpx.HTTPError as exc:
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
    project: Project | None = graph.project_of_task(db, task.id)
    if project is None:
        return
    total, done, progress = _compute_progress(project, db)

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
        "timestamp": datetime.now(UTC).isoformat(),
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
        prefix = integration.email_subject_prefix or "[Shard]"
        subject, html = build_notification_email(event, payload, prefix)
        await asyncio.to_thread(send_email, recipients, subject, html)

    # Send webhook notifications with delivery logging (background — non-blocking)
    for integration in webhook_integrations:
        await _dispatch_webhook(db, integration, event, payload, background=True)

    # Create in-app notification
    _create_notification(db, event, task, project)


_EVENT_MESSAGES = {
    "task.done": lambda t, p: (f'Task "{t.title}" completed in {p.name}', f"/projects/{p.id}"),
    "task.failed": lambda t, p: (f'Task "{t.title}" failed in {p.name}', f"/projects/{p.id}"),
    "task.due_soon": lambda t, p: (f'Task "{t.title}" is due soon', f"/projects/{p.id}"),
    "task.overdue": lambda t, p: (f'Task "{t.title}" is overdue', f"/projects/{p.id}"),
    "project.complete": lambda t, p: (f'All tasks in "{p.name}" are done!', f"/projects/{p.id}"),
}


def _create_notification(db: Session, event: str, task: Task, project: Project) -> None:
    factory = _EVENT_MESSAGES.get(event)
    if not factory:
        return
    message, link = factory(task, project)
    notif = Notification(
        type=event,
        message=message,
        link=link,
        project_id=project.id,
        task_id=task.id,
    )
    db.add(notif)
    db.commit()
    # Fire-and-forget broadcast (don't await — this is called from sync context too)
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(ws_manager.broadcast("notification.new", {"id": notif.id}))
    except Exception:
        pass


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


async def fire_test_notification(integration: Integration, db: Session | None = None) -> dict:
    payload = {
        "event": "test",
        "message": "This is a test notification from Shard.",
        "integration": {"id": integration.id, "name": integration.name, "type": integration.type},
        "project": {"name": "Test Project", "progress": 75.0, "total_tasks": 4, "done_tasks": 3},
        "task": {"title": "Test Task", "status": "done", "priority": "high"},
        "timestamp": datetime.now(UTC).isoformat(),
    }

    if integration.type == "email":
        if not integration.email_to:
            return {"success": False, "error": "No recipients configured"}
        if not smtp_configured():
            return {"success": False, "error": "SMTP not configured (set SMTP_HOST and SMTP_FROM env vars)"}
        recipients = [addr.strip() for addr in integration.email_to.split(",") if addr.strip()]
        prefix = integration.email_subject_prefix or "[Shard]"
        subject, html = build_notification_email("test", payload, prefix)
        ok = send_email(recipients, subject, html)
        return {"success": ok, "recipients": recipients} if ok else {"success": False, "error": "SMTP send failed"}

    if db:
        success = await _dispatch_webhook(db, integration, "test", payload)
        return {"success": success}

    try:
        body_bytes = json.dumps(payload, separators=(",", ":")).encode()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                integration.url,
                content=body_bytes,
                headers=_build_headers(integration, body_bytes),
            )
        return {"success": True, "status_code": resp.status_code, "body": resp.text[:200]}
    except httpx.HTTPError as exc:
        return {"success": False, "error": str(exc)}
