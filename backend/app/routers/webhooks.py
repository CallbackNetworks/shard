import hashlib
import hmac
import logging
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WebhookEvent
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


def _verify_signature(secret: str | None, request_body: bytes, headers: dict[str, str]) -> tuple[bool, str | None]:
    """Prove the caller holds this node's signing key.

    Returns ``(accepted, replay_key)``. ``replay_key`` is a digest of the signature and
    is present only for schemes that sign the *body*: an identical replay then produces
    an identical key, which is what :func:`_check_duplicate` keys on. GitLab's plain
    token is deliberately excluded — it is the same constant on every request, so
    deduplicating on it would reject every callback after the first.

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
        return False, None

    h = {k.lower(): v for k, v in headers.items()}

    # GitHub-style HMAC-SHA256 (X-Hub-Signature-256: sha256=<hex>)
    gh_sig = h.get("x-hub-signature-256", "")
    if gh_sig.startswith("sha256="):
        expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
        ok = hmac.compare_digest(f"sha256={expected}", gh_sig)
        return ok, (_replay_key(gh_sig) if ok else None)

    # GitLab-style secret token (X-Gitlab-Token: <token>)
    gl_token = h.get("x-gitlab-token", "")
    if gl_token:
        # No replay key: this token does not vary with the body.
        return hmac.compare_digest(secret, gl_token), None

    # Generic HMAC via X-Signature header
    generic_sig = h.get("x-signature", "")
    if generic_sig.startswith("sha256="):
        expected = hmac.new(secret.encode(), request_body, hashlib.sha256).hexdigest()
        ok = hmac.compare_digest(f"sha256={expected}", generic_sig)
        return ok, (_replay_key(generic_sig) if ok else None)

    # If secret is set but no recognized signature header was provided, reject
    return False, None


def _replay_key(signature: str) -> str:
    """A storable stand-in for a signature.

    The signature itself is an HMAC and does not disclose the key, but the delivery
    log is a path out for credentials once already (ADR-0085), so nothing derived
    from a secret is written to it in the clear.
    """
    return hashlib.sha256(signature.encode()).hexdigest()


def _check_replay(headers: dict[str, str]) -> bool:
    """Reject a request whose ``X-Webhook-Timestamp`` is stale or unreadable.

    A missing header still passes: GitHub, GitLab, Jenkins, Drone and Bitbucket do not
    send one, and requiring it would refuse every real CI integration. Body-bound
    replay is caught by :func:`_check_duplicate` instead, which needs nothing of the
    sender.

    A *malformed* header no longer passes. It used to, which meant the check was
    skippable by anyone who sent `X-Webhook-Timestamp: x` — the caller chose whether
    the protection ran.
    """
    h = {k.lower(): v for k, v in headers.items()}
    ts_str = h.get("x-webhook-timestamp", "")
    if not ts_str:
        return True

    try:
        ts = int(ts_str)
    except (ValueError, TypeError):
        return False
    return abs(time.time() - ts) <= MAX_TIMESTAMP_AGE_SECONDS


def _check_duplicate(db: Session, node_id: str, replay_key: str | None) -> bool:
    """False if this exact signed body was already accepted for this node, recently.

    Replay protection that does not depend on the sender: a replayed request carries a
    byte-identical body and therefore an identical signature. Bounded to
    ``MAX_TIMESTAMP_AGE_SECONDS`` so a provider legitimately re-sending the same
    payload later is not refused forever, and so the lookup stays on a narrow index
    range. Within that window two identical signed bodies are indistinguishable from a
    replay, and treating them as one is the safer reading.

    A delivery the handler *failed* leaves no row (the event is committed with the rest
    of the work), so a provider's retry after an error is still accepted.
    """
    if not replay_key:
        return True
    cutoff = datetime.now(UTC) - timedelta(seconds=MAX_TIMESTAMP_AGE_SECONDS)
    seen = (
        db.query(WebhookEvent.id)
        .filter(
            WebhookEvent.task_id == node_id,
            WebhookEvent.signature_digest == replay_key,
            WebhookEvent.created_at >= cutoff,
        )
        .first()
    )
    return seen is None


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
    signature_ok, replay_key = _verify_signature((node.data or {}).get("webhook_secret"), body_bytes, headers)
    if not signature_ok:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Replay protection, two layers: the sender's timestamp when it offers one, and
    # the signature itself, which every body-signing provider gives us for free.
    if not _check_replay(headers):
        raise HTTPException(status_code=401, detail="Webhook request expired (replay protection)")
    if not _check_duplicate(db, node.id, replay_key):
        raise HTTPException(status_code=409, detail="Webhook already delivered (replay protection)")

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
        signature_digest=replay_key,
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


# Build history used to be served from `GET /webhook/events/{task_id}`, right here. It is
# now `GET /api/nodes/{id}/webhook-events` and `GET /api/v1/nodes/{id}/webhook-events`
# (ADR-0085).
#
# This prefix is in `main.py`'s `_AUTH_BYPASS` for one reason: a CI runner cannot carry the
# owner's session, so `POST /callback/{token}` has to be reachable without one — and it
# authenticates itself, with a token that is the address plus a signature over the body
# (ADR-0060). That read authenticated itself with nothing. It was exempt purely because it
# shared a prefix with something that had earned the exemption, which is the same shape as
# ADR-0059: a rule attached to a path rather than to what the endpoint does.
#
# What remains under `/webhook/` is only what a runner posts to.
