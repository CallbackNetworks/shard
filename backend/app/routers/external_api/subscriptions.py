"""
External API v1 — Agent event subscriptions (webhook-based push notifications).

Allows agents to subscribe to platform events by registering a callback URL.
Uses the existing Integration model under the hood.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Integration
from app.routers.external_api.auth import (
    _auth_errors,
    _build_actor,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.services.activity import log_activity
from app.services.event_catalog import subscribable_events, validate_events

sub_router = APIRouter()


def _validate_events_or_422(db: Session, events: list[str]) -> None:
    """422 on an event nothing delivers.

    The vocabulary is the notifier's own list plus the events the user's active rules
    emit, so an agent can subscribe to a custom event a rule fires (ADR-0047, ADR-0048).
    """
    try:
        validate_events(db, events)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class SubscriptionCreate(BaseModel):
    name: str
    callback_url: str
    events: list[str] = ["task.done", "task.failed", "project.complete"]
    secret: str | None = None
    project_id: str | None = None


class SubscriptionOut(BaseModel):
    id: str
    name: str
    callback_url: str
    events: list[str]
    project_id: str | None
    active: bool

    model_config = {"from_attributes": True}


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    callback_url: str | None = None
    events: list[str] | None = None
    active: bool | None = None


@sub_router.get(
    "/subscriptions/events",
    summary="List available events",
    description="Returns all event types that can be subscribed to.",
    responses=_auth_errors,
)
def api_list_events(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return subscribable_events(db)


@sub_router.get(
    "/subscriptions",
    summary="List event subscriptions",
    description="Lists all webhook subscriptions created by this API key. Requires `read` scope.",
    response_model=list[SubscriptionOut],
    responses=_auth_errors,
)
def api_list_subscriptions(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    integrations = (
        db.query(Integration)
        .filter(Integration.type == "webhook", Integration.name.startswith(f"agent:{api_key.name}:"))
        .order_by(Integration.created_at.desc())
        .all()
    )
    return [
        SubscriptionOut(
            id=i.id,
            name=i.name,
            callback_url=i.url,
            events=i.events or [],
            project_id=i.project_id,
            active=i.active,
        )
        for i in integrations
    ]


@sub_router.post(
    "/subscriptions",
    status_code=status.HTTP_201_CREATED,
    summary="Subscribe to events",
    description=(
        "Register a callback URL to receive webhook notifications for specified events. "
        "Optionally scope to a specific project. The platform will POST a JSON payload "
        "to your callback URL whenever a matching event occurs. Requires `write` scope."
    ),
    response_model=SubscriptionOut,
    responses=_auth_errors,
)
def api_create_subscription(
    body: SubscriptionCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    if body.project_id:
        _check_project_access(db, api_key, body.project_id)

    _validate_events_or_422(db, body.events)

    agent_suffix = x_agent_id or "default"
    integration = Integration(
        name=f"agent:{api_key.name}:{agent_suffix}:{body.name}",
        type="webhook",
        url=body.callback_url,
        secret=body.secret,
        events=body.events,
        project_id=body.project_id,
        active=True,
    )
    db.add(integration)
    db.flush()

    actor = _build_actor(api_key, x_agent_id)
    log_activity(
        db,
        "subscription.created",
        actor=actor,
        detail=f"Agent subscribed to {len(body.events)} events at {body.callback_url}",
        meta={"events": body.events, "subscription_id": integration.id},
    )
    db.commit()

    return SubscriptionOut(
        id=integration.id,
        name=body.name,
        callback_url=integration.url,
        events=integration.events,
        project_id=integration.project_id,
        active=True,
    )


@sub_router.patch(
    "/subscriptions/{subscription_id}",
    summary="Update a subscription",
    description="Update subscription events, callback URL, or active status. Requires `write` scope.",
    response_model=SubscriptionOut,
    responses={**_auth_errors, 404: {"description": "Subscription not found"}},
)
def api_update_subscription(
    subscription_id: str,
    body: SubscriptionUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    integration = (
        db.query(Integration)
        .filter(
            Integration.id == subscription_id,
            Integration.type == "webhook",
            Integration.name.startswith(f"agent:{api_key.name}:"),
        )
        .first()
    )
    if not integration:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if body.events is not None:
        _validate_events_or_422(db, body.events)
        integration.events = body.events
    if body.callback_url is not None:
        integration.url = body.callback_url
    if body.active is not None:
        integration.active = body.active
    if body.name is not None:
        parts = integration.name.split(":")
        parts[-1] = body.name
        integration.name = ":".join(parts)

    db.commit()
    db.refresh(integration)

    return SubscriptionOut(
        id=integration.id,
        name=body.name or integration.name.split(":")[-1],
        callback_url=integration.url,
        events=integration.events or [],
        project_id=integration.project_id,
        active=integration.active,
    )


@sub_router.delete(
    "/subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unsubscribe",
    description="Remove an event subscription. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Subscription not found"}},
)
def api_delete_subscription(
    subscription_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    integration = (
        db.query(Integration)
        .filter(
            Integration.id == subscription_id,
            Integration.type == "webhook",
            Integration.name.startswith(f"agent:{api_key.name}:"),
        )
        .first()
    )
    if not integration:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(integration)
    db.commit()
