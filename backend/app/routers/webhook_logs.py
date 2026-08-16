"""Webhook delivery logs for the SPA.

Thin over ``services/delivery_admin``, which ``/api/v1`` calls too (ADR-0085).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import WebhookDeliveryOut
from app.services import delivery_admin

router = APIRouter(tags=["webhook-logs"])


@router.get("/deliveries", response_model=list[WebhookDeliveryOut])
def list_all_deliveries(
    delivery_status: str | None = Query(None, alias="status"),
    integration_id: str | None = Query(None),
    event: str | None = Query(None, description="Filter by event type (e.g. task.done)"),
    status_code: int | None = Query(None, description="Filter by HTTP status code"),
    since: datetime | None = Query(None, description="Only deliveries after this time (ISO 8601)"),
    until: datetime | None = Query(None, description="Only deliveries before this time (ISO 8601)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
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


@router.get("/integrations/{integration_id}/deliveries", response_model=list[WebhookDeliveryOut])
def list_deliveries(
    integration_id: str,
    delivery_status: str | None = Query(None, alias="status"),
    event: str | None = Query(None, description="Filter by event type"),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return delivery_admin.list_deliveries(
        db,
        integration_id=integration_id,
        status=delivery_status,
        event=event,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
        require_integration=True,
    )


@router.get("/integrations/{integration_id}/health")
def integration_health(integration_id: str, db: Session = Depends(get_db)):
    """Get delivery health stats for an integration."""
    return delivery_admin.health(db, integration_id)


@router.get("/deliveries/{delivery_id}", response_model=WebhookDeliveryOut)
def get_delivery(delivery_id: str, db: Session = Depends(get_db)):
    return delivery_admin.get_delivery(db, delivery_id)


@router.post("/deliveries/{delivery_id}/retry", response_model=WebhookDeliveryOut)
async def manual_retry(delivery_id: str, db: Session = Depends(get_db)):
    return await delivery_admin.retry(db, delivery_id)


@router.post("/integrations/{integration_id}/retry-all")
async def bulk_retry(integration_id: str, db: Session = Depends(get_db)):
    """Retry all failed/dead deliveries for an integration."""
    return await delivery_admin.retry_all(db, integration_id)


@router.delete("/deliveries", status_code=status.HTTP_204_NO_CONTENT)
def purge_old_deliveries(
    older_than_days: int = Query(30, ge=1),
    delivery_status: str | None = Query(None, alias="status", description="Only purge deliveries with this status"),
    db: Session = Depends(get_db),
):
    delivery_admin.purge(db, older_than_days=older_than_days, status=delivery_status)
