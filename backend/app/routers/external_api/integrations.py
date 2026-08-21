"""External API v1 — outbound integrations and their delivery logs (ADR-0085).

``/subscriptions`` is this surface with three things nailed shut (type always ``webhook``,
name always prefixed, credentials and templates unreachable). It stays, because it is a
pleasant shape for the common case; this is the general form underneath it.

Reads take ``read``, writes take ``write`` — the same scopes ``/subscriptions`` has always
used for the same objects. Purging the delivery log takes ``admin``: it destroys history
rather than data, and history is what an audit reads.

A container-scoped key (project or identity, ADR-0107) sees and writes only integrations
bound to a project within its scope. An *unscoped* integration (``project_id: null``)
receives events from every project, so a scoped key can read it but not edit it: it is not
that key's to change.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Integration
from app.routers.external_api.auth import _auth_errors, _get_api_key, _project_ids_in_scope, _require_scope
from app.schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate, WebhookDeliveryOut
from app.services import delivery_admin, integration_admin

sub_router = APIRouter()


def _owned(db: Session, api_key: ApiKey, integration: Integration, *, writing: bool) -> None:
    """403 unless a container-scoped key governs this integration (ADR-0107).

    Reading an unscoped integration is allowed — its events reach every project this key
    can see, so it is part of the answer to "what is subscribed to my work". Writing one is
    not: it is shared with every other project too.
    """
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is None:
        return
    if integration.project_id in scoped_project_ids:
        return
    if integration.project_id is None and not writing:
        return
    raise HTTPException(status_code=403, detail="API key does not have access to this integration")


def _load_owned(db: Session, api_key: ApiKey, integration_id: str, *, writing: bool) -> Integration:
    integration = integration_admin.load(db, integration_id)
    _owned(db, api_key, integration, writing=writing)
    return integration


@sub_router.get(
    "/integrations/events",
    summary="Event types an integration can subscribe to",
    description=(
        "The event vocabulary, generated from what the notifier actually delivers plus the "
        "events your own active workflow rules emit (ADR-0047, ADR-0048) — so a custom event "
        "is subscribable as soon as something emits it. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_events(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return integration_admin.events_catalog(db)


@sub_router.get(
    "/integrations/sources",
    summary="Causes an integration can narrow to",
    description="Empty selection means every source, so this is a filter rather than a requirement (ADR-0048).",
    responses=_auth_errors,
)
def api_list_sources(api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return integration_admin.sources_catalog()


@sub_router.get(
    "/integrations/templates",
    summary="Integration templates for common CI/CD platforms",
    responses=_auth_errors,
)
def api_list_templates(api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return integration_admin.templates_catalog()


@sub_router.get(
    "/integrations/templates/{template_id}",
    summary="One template, with setup instructions and an example payload",
    responses=_auth_errors,
)
def api_get_template(template_id: str, api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return integration_admin.template(template_id)


@sub_router.get(
    "/integrations",
    response_model=list[IntegrationOut],
    summary="List outbound integrations",
    description=(
        "Every configured notification target: webhooks and email. Credentials never come "
        "back — `secret` reads as `secret_set: true`, and `auth_config`/`custom_headers` "
        "keep their keys with `null` values (ADR-0063). Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_integrations(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is None:
        return integration_admin.list_integrations(db)
    if len(scoped_project_ids) == 1:
        return integration_admin.list_integrations(db, project_id=scoped_project_ids[0])
    allowed = set(scoped_project_ids)
    return [i for i in integration_admin.list_integrations(db) if i.project_id is None or i.project_id in allowed]


@sub_router.post(
    "/integrations",
    response_model=IntegrationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an outbound integration",
    description=(
        "Registers a webhook or email target for platform events. `GET /integrations/events` "
        "lists what may go in `events`; an event nothing delivers is a 422. Webhook payloads "
        "are signed with HMAC-SHA256 in `X-Signature`/`X-Hub-Signature-256` when `secret` is "
        "set. `POST /integrations/{id}/test` fires a test delivery. Requires `write` scope."
    ),
    responses=_auth_errors,
)
def api_create_integration(
    body: IntegrationCreate, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if scoped_project_ids is not None and body.project_id not in scoped_project_ids:
        raise HTTPException(status_code=403, detail="API key can only create integrations within its scope")
    return integration_admin.create(db, body)


@sub_router.patch(
    "/integrations/{integration_id}",
    response_model=IntegrationOut,
    summary="Update an outbound integration",
    description=(
        "Partial update. Because credentials are withheld on read, `null` means *unchanged* "
        "for `auth_config`/`custom_headers` keys — so a client can GET, edit one field and "
        "PATCH back without destroying a credential it was never shown (ADR-0063). Requires "
        "`write` scope."
    ),
    responses=_auth_errors,
)
def api_update_integration(
    integration_id: str,
    body: IntegrationUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _load_owned(db, api_key, integration_id, writing=True)
    return integration_admin.update(db, integration_id, body)


@sub_router.delete(
    "/integrations/{integration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an outbound integration",
    responses=_auth_errors,
)
def api_delete_integration(integration_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _load_owned(db, api_key, integration_id, writing=True)
    integration_admin.delete(db, integration_id)


@sub_router.post(
    "/integrations/{integration_id}/test",
    summary="Fire a test notification",
    description="Sends a synthetic event to the target and returns what it answered. Requires `write` scope.",
    responses=_auth_errors,
)
async def api_test_integration(
    integration_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _load_owned(db, api_key, integration_id, writing=True)
    return await integration_admin.test(db, integration_id)


# ── Delivery log ──────────────────────────────────────────────────
#
# The other half of "configure a callback": the failure mode of a webhook is silence, and
# silence cannot be detected from the sending side without this.


@sub_router.get(
    "/deliveries",
    response_model=list[WebhookDeliveryOut],
    summary="Webhook delivery log",
    description=(
        "Every outbound delivery attempt, newest first, with the response the target gave "
        "and the next scheduled retry. Credential headers read as `***`. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_deliveries(
    delivery_status: str | None = Query(None, alias="status"),
    integration_id: str | None = Query(None),
    event: str | None = Query(None, description="Filter by event type (e.g. task.done)"),
    status_code: int | None = Query(None, description="Filter by HTTP status code"),
    since: datetime | None = Query(None, description="Only deliveries after this time (ISO 8601)"),
    until: datetime | None = Query(None, description="Only deliveries before this time (ISO 8601)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    if integration_id:
        _load_owned(db, api_key, integration_id, writing=False)
    return delivery_admin.list_deliveries(
        db,
        integration_id=integration_id,
        status=delivery_status,
        event=event,
        status_code=status_code,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )


@sub_router.get(
    "/deliveries/{delivery_id}",
    response_model=WebhookDeliveryOut,
    summary="One delivery attempt",
    responses=_auth_errors,
)
def api_get_delivery(delivery_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    delivery = delivery_admin.get_delivery(db, delivery_id)
    _load_owned(db, api_key, delivery.integration_id, writing=False)
    return delivery


@sub_router.post(
    "/deliveries/{delivery_id}/retry",
    response_model=WebhookDeliveryOut,
    summary="Retry one failed delivery",
    description="Only `failed` or `dead` deliveries can be retried; the backoff starts over. Requires `write` scope.",
    responses=_auth_errors,
)
async def api_retry_delivery(delivery_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    delivery = delivery_admin.get_delivery(db, delivery_id)
    _load_owned(db, api_key, delivery.integration_id, writing=True)
    return await delivery_admin.retry(db, delivery_id)


@sub_router.get(
    "/integrations/{integration_id}/health",
    summary="Delivery health for one integration",
    description="Success rate, failures, dead deliveries, average latency and last success over 7 days.",
    responses=_auth_errors,
)
def api_integration_health(integration_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    _load_owned(db, api_key, integration_id, writing=False)
    return delivery_admin.health(db, integration_id)


@sub_router.post(
    "/integrations/{integration_id}/retry-all",
    summary="Retry every failed delivery for an integration",
    responses=_auth_errors,
)
async def api_retry_all(integration_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _load_owned(db, api_key, integration_id, writing=True)
    return await delivery_admin.retry_all(db, integration_id)


@sub_router.delete(
    "/deliveries",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Purge old delivery log rows",
    description="Destroys history rather than data, which is why this one takes `admin` scope.",
    responses=_auth_errors,
)
def api_purge_deliveries(
    older_than_days: int = Query(30, ge=1),
    delivery_status: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    delivery_admin.purge(db, older_than_days=older_than_days, status=delivery_status)
