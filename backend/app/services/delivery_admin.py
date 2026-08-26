"""Webhook delivery logs: read, retry, purge — for both doors (ADR-0085).

An agent that can create an outbound integration (``/api/v1/subscriptions`` since long
before this, every integration since ADR-0085) could not see whether a single delivery had
ever succeeded. Configuring a callback and being unable to read its delivery log is half a
capability: the failure mode of a webhook is silence, and silence is exactly what you
cannot detect from the sending side without this.

It also carries the redaction that ``request_headers`` needed before this log could be
served to an API key at all — see ``public_headers``.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Integration, WebhookDelivery
from app.services.errors import Invalid, NotFound

# Header names that are a credential wherever they appear. `authorization` was the whole
# list, and it was the whole list back when `auth_type` only meant bearer.
_ALWAYS_SECRET = ("authorization",)

REDACTED = "***"


def secret_header_names(integration: Integration | None) -> set[str]:
    """Which of an outgoing request's headers carry this integration's credentials.

    Derived from the integration rather than matched against a list of likely names, because
    the user chooses the names: ``auth_type="api_key"`` puts the key in whatever
    ``auth_config["header_name"]`` says (``X-API-Key`` only by default), and
    ``custom_headers`` is a free-form dict somebody may well have put a token in.

    ADR-0063 withholds ``auth_config`` and ``custom_headers`` when an integration is read.
    The delivery log then stored the *resulting headers* verbatim and served them — the same
    credential leaving by a second path, which is the shape ADR-0059 and ADR-0063 each found
    once already.
    """
    names = set(_ALWAYS_SECRET)
    if integration is None:
        return names
    auth_config = getattr(integration, "auth_config", None) or {}
    if getattr(integration, "auth_type", None) == "api_key":
        names.add(str(auth_config.get("header_name") or "X-API-Key").lower())
    for key in getattr(integration, "custom_headers", None) or {}:
        names.add(str(key).lower())
    return names


def public_headers(headers: dict | None, integration: Integration | None) -> dict:
    """The servable view of a delivery's request headers.

    Applied on read, not only on write, so rows recorded before this rule existed are
    redacted too. A log is written once and read forever; fixing only the writer would leave
    every historical row leaking.
    """
    if not headers:
        return headers or {}
    secret = secret_header_names(integration)
    return {k: (REDACTED if k.lower() in secret else v) for k, v in headers.items()}


def _redacted(db: Session, deliveries: list[WebhookDelivery]) -> list[WebhookDelivery]:
    """Blank the credential headers on the way out. Mutates the loaded instances, so the
    caller must not commit after calling this — every consumer here is a read."""
    ids = {d.integration_id for d in deliveries}
    by_id = {i.id: i for i in db.query(Integration).filter(Integration.id.in_(ids)).all()} if ids else {}
    for d in deliveries:
        d.request_headers = public_headers(d.request_headers, by_id.get(d.integration_id))
    return deliveries


def _require_integration(db: Session, integration_id: str) -> Integration:
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise NotFound("Integration not found")
    return integration


def list_deliveries(
    db: Session,
    *,
    integration_id: str | None = None,
    status: str | None = None,
    event: str | None = None,
    status_code: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
    require_integration: bool = False,
) -> list[WebhookDelivery]:
    if require_integration and integration_id:
        _require_integration(db, integration_id)
    q = db.query(WebhookDelivery)
    if integration_id:
        q = q.filter(WebhookDelivery.integration_id == integration_id)
    if status:
        q = q.filter(WebhookDelivery.status == status)
    if event:
        q = q.filter(WebhookDelivery.event == event)
    if status_code:
        q = q.filter(WebhookDelivery.status_code == status_code)
    if since:
        q = q.filter(WebhookDelivery.created_at >= since)
    if until:
        q = q.filter(WebhookDelivery.created_at <= until)
    rows = q.order_by(WebhookDelivery.created_at.desc()).offset(offset).limit(limit).all()
    return _redacted(db, rows)


def get_delivery(db: Session, delivery_id: str) -> WebhookDelivery:
    delivery = db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
    if not delivery:
        raise NotFound("Delivery not found")
    return _redacted(db, [delivery])[0]


def health(db: Session, integration_id: str) -> dict:
    """Delivery health for one integration over the last 7 days."""
    _require_integration(db, integration_id)
    cutoff = datetime.now(UTC) - timedelta(days=7)
    deliveries = (
        db.query(WebhookDelivery)
        .filter(WebhookDelivery.integration_id == integration_id, WebhookDelivery.created_at >= cutoff)
        .all()
    )
    total = len(deliveries)
    successes = sum(1 for d in deliveries if d.status == "success")
    failures = sum(1 for d in deliveries if d.status in ("failed", "dead"))
    last_success = (
        db.query(WebhookDelivery)
        .filter(WebhookDelivery.integration_id == integration_id, WebhookDelivery.status == "success")
        .order_by(WebhookDelivery.delivered_at.desc())
        .first()
    )
    settled = [d for d in deliveries if d.status == "success" and d.delivered_at and d.created_at]
    avg_latency_ms = (
        int(sum((d.delivered_at - d.created_at).total_seconds() * 1000 for d in settled) / len(settled))
        if settled
        else None
    )
    return {
        "integration_id": integration_id,
        "period_days": 7,
        "total_deliveries": total,
        "successes": successes,
        "failures": failures,
        "dead": sum(1 for d in deliveries if d.status == "dead"),
        "success_rate": round(successes / total * 100, 1) if total > 0 else 0.0,
        "avg_latency_ms": avg_latency_ms,
        "last_success_at": last_success.delivered_at.isoformat()
        if last_success and last_success.delivered_at
        else None,
    }


async def retry(db: Session, delivery_id: str) -> WebhookDelivery:
    from app.services.notifier import retry_delivery

    delivery = db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
    if not delivery:
        raise NotFound("Delivery not found")
    if delivery.status not in ("failed", "dead"):
        raise Invalid("Only failed or dead deliveries can be retried")
    delivery.attempt = 0  # a manual retry starts the backoff over
    await retry_delivery(db, delivery)
    db.refresh(delivery)
    return _redacted(db, [delivery])[0]


async def retry_all(db: Session, integration_id: str) -> dict:
    from app.services.notifier import retry_delivery

    _require_integration(db, integration_id)
    failed = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.integration_id == integration_id,
            WebhookDelivery.status.in_(["failed", "dead"]),
        )
        .all()
    )
    retried = succeeded = 0
    for delivery in failed:
        delivery.attempt = 0
        result = await retry_delivery(db, delivery)
        retried += 1
        if result:
            succeeded += 1
    return {"retried": retried, "succeeded": succeeded, "failed": retried - succeeded}


def purge(db: Session, *, older_than_days: int = 30, status: str | None = None) -> None:
    cutoff = datetime.now(UTC) - timedelta(days=older_than_days)
    q = db.query(WebhookDelivery).filter(WebhookDelivery.created_at < cutoff)
    if status:
        q = q.filter(WebhookDelivery.status == status)
    # `synchronize_session=False` because this is a bulk delete and the caller has no
    # use for the session afterwards. The default tries to evaluate the criteria in
    # Python against whatever is already loaded, and `created_at` is stored naive on
    # SQLite while `cutoff` is timezone-aware — so purging raised TypeError whenever a
    # delivery happened to be in the session, and worked fine when none was.
    q.delete(synchronize_session=False)
    db.commit()
