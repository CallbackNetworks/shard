import hashlib
import hmac
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Node, WebhookEvent
from app.schemas import TaskOut, WebhookEventOut
from app.services import graph
from app.services.activity import log_activity
from app.services.cicd_adapters import PROVIDER_PARSERS, normalize_webhook_payload
from app.services.enrichment import enrich_task
from app.services.task_mutations import apply_task_update
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["webhook"])

# What a build-history row says when the callback carried no status we recognise. The
# column is not nullable, and "we could not read this" is itself worth recording.
UNMAPPED_STATUS = "unmapped"

# Maximum age for webhook requests (5 minutes) - replay protection
MAX_TIMESTAMP_AGE_SECONDS = 300


def _verify_signature(secret: str | None, request_body: bytes, headers: dict[str, str]) -> bool:
    """Prove the caller holds this node's signing key.

    Supports GitHub HMAC-SHA256, GitLab's plain token, and a generic HMAC header.

    This used to return ``True`` when a task had no secret, which made the callback URL
    the entire credential: anyone who read it out of a browser history, a proxy log, a
    screenshot or a pasted CI config could post build results. Every task is issued a
    secret at creation now, so a missing one means a node predating that change or one
    cleared by hand — neither is a reason to accept an unsigned write (ADR-0060). A
    container gets one lazily on first reveal (``GET /api/nodes/{id}/webhook``), so a
    missing secret there means nobody has configured it yet — same refusal applies.
    """
    if not secret:
        return False

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


@router.post("/callback/{callback_token}")
async def webhook_callback(
    callback_token: str,
    request: Request,
    db: Session = Depends(get_db),
    provider: str | None = Query(
        None, description="Force CI/CD provider detection (github, gitlab, jenkins, drone, bitbucket, gitea)"
    ),
) -> TaskOut | WebhookEventOut:
    """
    Inbound CI/CD webhook callback.

    Accepts either the simple format {"status": "done", "message": "..."} or
    native payloads from GitHub Actions, GitLab CI, Jenkins, Drone, Bitbucket Pipelines,
    or Gitea (push and Actions run/job events). The provider is auto-detected from
    headers, or can be forced via ?provider= query param.

    The token may belong to a task (a build outcome drives its status, unchanged since
    ADR-0060) or a container/project (there is no status to drive — every event is only
    logged, see the role branch below; ADR-0082).
    """
    # A misspelled hint used to fall through to generic parsing, so ?provider=githbu
    # quietly parsed a GitHub payload with the wrong adapter and reported whatever that
    # produced. The caller asked for a specific adapter; say so if it does not exist.
    if provider is not None and provider not in PROVIDER_PARSERS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown provider {provider!r}; expected one of {sorted(PROVIDER_PARSERS)}",
        )

    node = graph.find_node_by_callback_token(db, callback_token)
    if not node:
        raise HTTPException(status_code=404, detail="Invalid callback token")

    # Read raw body for signature verification
    body_bytes = await request.body()
    headers = dict(request.headers)

    # Signature verification
    if not _verify_signature((node.data or {}).get("webhook_secret"), body_bytes, headers):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Replay protection
    if not _check_replay(headers):
        raise HTTPException(status_code=401, detail="Webhook request expired (replay protection)")

    # Parse JSON body
    import json

    try:
        body = json.loads(body_bytes) if body_bytes else {}
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    # Normalize the payload through CI/CD adapters
    normalized = normalize_webhook_payload(headers, body, provider_hint=provider)

    # Store webhook event for build history (committed below).
    webhook_event = WebhookEvent(
        task_id=node.id,
        provider=normalized.get("provider", "generic"),
        event_type=normalized.get("event_type"),
        status=normalized["status"] or UNMAPPED_STATUS,
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

    if node.type not in graph.task_type_keys(db):
        # A container (project) has no build outcome to apply — a push carries none to
        # begin with, and a build-status event's outcome describes the *build*, not the
        # project. Every callback here is only logged, never mutates the node (ADR-0082).
        log_activity(
            db,
            action="webhook.container_event",
            project_id=node.id,
            task_id=None,
            actor="webhook",
            detail=normalized.get("message") or f"Callback received from {normalized.get('provider', 'generic')}",
            meta={
                "provider": normalized.get("provider"),
                "event_type": normalized.get("event_type"),
                "status": normalized["status"],
                "branch": normalized.get("branch"),
                "commit_sha": normalized.get("commit_sha"),
            },
        )
        db.commit()
        db.refresh(webhook_event)
        await ws_manager.broadcast("project.webhook_event", {"project_id": node.id})
        return WebhookEventOut.model_validate(webhook_event)

    if normalized["status"] is None:
        # The payload carried no outcome this system recognises. Record what arrived and
        # leave the task where it is: guessing used to mean "done", so a timed-out build
        # closed the task it should have flagged (ADR-0051). The build history row above
        # and this entry are the whole point — an unmapped callback must be findable.
        raw = normalized.get("raw_status")
        log_activity(
            db,
            action="webhook.unmapped_status",
            project_id=graph.project_id_of_task(db, node.id),
            task_id=node.id,
            actor="webhook",
            detail=(
                f"Callback from {normalized.get('provider', 'generic')} carried no status this "
                f"system recognises ({raw!r}); task left unchanged"
            ),
            meta={"provider": normalized.get("provider"), "raw_status": raw},
        )
        db.commit()
        return enrich_task(graph.get_task(db, node.id), db)

    # sync_external=False: the change originated externally, echoing it back
    # to the external issue would loop.
    task = await apply_task_update(
        db,
        node.id,
        {"status": normalized["status"]},
        actor="webhook",
        source="webhook",
        sync_external=False,
        activity_meta={
            "source": "webhook",
            "provider": normalized.get("provider"),
            "commit_sha": normalized.get("commit_sha"),
            "branch": normalized.get("branch"),
            "build_url": normalized.get("build_url"),
        },
    )
    return enrich_task(task, db)


@router.get("/events/{task_id}", response_model=list[WebhookEventOut])
def get_webhook_events(
    task_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Get build history (webhook events) for a task or a container/project."""
    node = db.get(Node, task_id)
    if node is None or node.type not in graph.webhookable_type_keys(db):
        raise HTTPException(status_code=404, detail="Node not found")
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.task_id == task_id)
        .order_by(WebhookEvent.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
