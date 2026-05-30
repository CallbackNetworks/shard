import hashlib
import hmac
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Task, WebhookEvent
from app.schemas import TaskOut, WebhookCallback, WebhookEventOut
from app.services.activity import log_activity
from app.services.cicd_adapters import normalize_webhook_payload
from app.services.notifier import fire_notifications
from app.services.rules_engine import run_rules

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["webhook"])

# Maximum age for webhook requests (5 minutes) - replay protection
MAX_TIMESTAMP_AGE_SECONDS = 300


def _verify_signature(task: Task, request_body: bytes, headers: dict[str, str]) -> bool:
    """
    Verify inbound webhook signature if task.webhook_secret is configured.
    Supports: GitHub HMAC-SHA256, GitLab token, generic HMAC.
    Returns True if valid or if no secret is configured (open mode).
    """
    secret = task.webhook_secret
    if not secret:
        return True  # No secret configured = accept all

    h = {k.lower(): v for k, v in headers.items()}

    # GitHub-style HMAC-SHA256 (X-Hub-Signature-256: sha256=<hex>)
    gh_sig = h.get("x-hub-signature-256", "")
    if gh_sig.startswith("sha256="):
        expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(f"sha256={expected}", gh_sig)

    # GitLab-style secret token (X-Gitlab-Token: <token>)
    gl_token = h.get("x-gitlab-token", "")
    if gl_token:
        return hmac.compare_digest(secret, gl_token)

    # Generic HMAC via X-Signature header
    generic_sig = h.get("x-signature", "")
    if generic_sig.startswith("sha256="):
        expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(f"sha256={expected}", generic_sig)

    # If secret is set but no recognized signature header was provided, reject
    return False


def _check_replay(headers: dict[str, str]) -> bool:
    """
    Check timestamp-based replay protection (optional).
    If X-Webhook-Timestamp is present, reject if too old.
    """
    h = {k.lower(): v for k, v in headers.items()}
    ts_str = h.get("x-webhook-timestamp", "")
    if not ts_str:
        return True  # No timestamp header = skip check

    try:
        ts = int(ts_str)
        return abs(time.time() - ts) <= MAX_TIMESTAMP_AGE_SECONDS
    except (ValueError, TypeError):
        return True  # Malformed timestamp = skip check


@router.post("/callback/{callback_token}", response_model=TaskOut)
async def webhook_callback(
    callback_token: str,
    request: Request,
    db: Session = Depends(get_db),
    provider: str | None = Query(None, description="Force CI/CD provider detection (github, gitlab, jenkins, drone, bitbucket)"),
):
    """
    Inbound CI/CD webhook callback.

    Accepts either the simple format {"status": "done", "message": "..."} or
    native payloads from GitHub Actions, GitLab CI, Jenkins, Drone, Bitbucket Pipelines.
    The provider is auto-detected from headers, or can be forced via ?provider= query param.
    """
    task = db.query(Task).filter(Task.callback_token == callback_token).first()
    if not task:
        raise HTTPException(status_code=404, detail="Invalid callback token")

    # Read raw body for signature verification
    body_bytes = await request.body()
    headers = dict(request.headers)

    # Signature verification
    if not _verify_signature(task, body_bytes, headers):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Replay protection
    if not _check_replay(headers):
        raise HTTPException(status_code=401, detail="Webhook request expired (replay protection)")

    # Parse JSON body
    import json

    try:
        body = json.loads(body_bytes) if body_bytes else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Normalize the payload through CI/CD adapters
    normalized = normalize_webhook_payload(headers, body, provider_hint=provider)

    prev_status = task.status
    task.status = normalized["status"]

    # Build a human-readable detail message
    detail_msg = normalized.get("message") or f"Status changed to {normalized['status']} via webhook"
    if normalized.get("provider") != "generic":
        detail_msg = f'[{normalized["provider"]}] {detail_msg}'

    log_activity(
        db,
        "task.status_changed",
        project_id=task.project_id,
        task_id=task.id,
        actor="webhook",
        detail=f'Task "{task.title}" changed from {prev_status} to {normalized["status"]} via webhook',
        meta={
            "old_status": prev_status,
            "new_status": normalized["status"],
            "source": "webhook",
            "provider": normalized.get("provider"),
            "commit_sha": normalized.get("commit_sha"),
            "branch": normalized.get("branch"),
            "build_url": normalized.get("build_url"),
        },
    )

    # Store webhook event for build history
    webhook_event = WebhookEvent(
        task_id=task.id,
        provider=normalized.get("provider", "generic"),
        event_type=normalized.get("event_type"),
        status=normalized["status"],
        message=normalized.get("message"),
        commit_sha=normalized.get("commit_sha"),
        branch=normalized.get("branch"),
        build_url=normalized.get("build_url"),
        build_number=normalized.get("build_number"),
        build_duration_ms=normalized.get("build_duration_ms"),
        triggered_by=normalized.get("triggered_by"),
        test_summary=normalized.get("test_summary"),
        raw_payload=normalized.get("raw_payload"),
    )
    db.add(webhook_event)

    db.commit()
    db.refresh(task)

    # Reload with project relationship
    task = db.query(Task).filter(Task.id == task.id).first()
    _ = task.project

    event = f"task.{normalized['status']}"
    await fire_notifications(db, task, event)

    # Run workflow rules on status change
    if prev_status != normalized["status"]:
        run_rules(db, "task.status_changed", task, {"old_status": prev_status, "_rule_depth": 1})

    # If all tasks are done, also fire project.complete
    project: Project = task.project
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    if total > 0 and done == total:
        await fire_notifications(db, task, "project.complete")

    return task


@router.get("/events/{task_id}", response_model=list[WebhookEventOut])
def get_webhook_events(
    task_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Get build history (webhook events) for a task."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.task_id == task_id)
        .order_by(WebhookEvent.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
