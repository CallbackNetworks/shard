from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Integration, WebhookDelivery
from app.schemas import WebhookDeliveryOut
from app.services.notifier import retry_delivery

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
    q = db.query(WebhookDelivery)
    if integration_id:
        q = q.filter(WebhookDelivery.integration_id == integration_id)
    if delivery_status:
        q = q.filter(WebhookDelivery.status == delivery_status)
    if event:
        q = q.filter(WebhookDelivery.event == event)
    if status_code:
        q = q.filter(WebhookDelivery.status_code == status_code)
    if since:
        q = q.filter(WebhookDelivery.created_at >= since)
    if until:
        q = q.filter(WebhookDelivery.created_at <= until)
    return q.order_by(WebhookDelivery.created_at.desc()).offset(offset).limit(limit).all()


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
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    q = db.query(WebhookDelivery).filter(WebhookDelivery.integration_id == integration_id)
    if delivery_status:
        q = q.filter(WebhookDelivery.status == delivery_status)
    if event:
        q = q.filter(WebhookDelivery.event == event)
    if since:
        q = q.filter(WebhookDelivery.created_at >= since)
    if until:
        q = q.filter(WebhookDelivery.created_at <= until)
    return q.order_by(WebhookDelivery.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/integrations/{integration_id}/health")
def integration_health(
    integration_id: str,
    db: Session = Depends(get_db),
):
    """Get delivery health stats for an integration."""
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    # Stats from last 7 days
    cutoff = datetime.now(UTC) - timedelta(days=7)
    deliveries = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.integration_id == integration_id,
            WebhookDelivery.created_at >= cutoff,
        )
        .all()
    )

    total = len(deliveries)
    successes = sum(1 for d in deliveries if d.status == "success")
    failures = sum(1 for d in deliveries if d.status in ("failed", "dead"))
    success_rate = round(successes / total * 100, 1) if total > 0 else 0.0

    # Last success time
    last_success = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.integration_id == integration_id,
            WebhookDelivery.status == "success",
        )
        .order_by(WebhookDelivery.delivered_at.desc())
        .first()
    )

    # Average response time (from created to delivered for successes)
    avg_latency_ms = None
    success_deliveries = [d for d in deliveries if d.status == "success" and d.delivered_at and d.created_at]
    if success_deliveries:
        total_ms = sum(
            (d.delivered_at - d.created_at).total_seconds() * 1000 for d in success_deliveries
        )
        avg_latency_ms = int(total_ms / len(success_deliveries))

    # Dead deliveries (permanently failed)
    dead_count = sum(1 for d in deliveries if d.status == "dead")

    return {
        "integration_id": integration_id,
        "period_days": 7,
        "total_deliveries": total,
        "successes": successes,
        "failures": failures,
        "dead": dead_count,
        "success_rate": success_rate,
        "avg_latency_ms": avg_latency_ms,
        "last_success_at": last_success.delivered_at.isoformat() if last_success and last_success.delivered_at else None,
    }


@router.get("/deliveries/{delivery_id}", response_model=WebhookDeliveryOut)
def get_delivery(delivery_id: str, db: Session = Depends(get_db)):
    delivery = db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return delivery


@router.post("/deliveries/{delivery_id}/retry", response_model=WebhookDeliveryOut)
async def manual_retry(delivery_id: str, db: Session = Depends(get_db)):
    delivery = db.query(WebhookDelivery).filter(WebhookDelivery.id == delivery_id).first()
    if not delivery:
        raise HTTPException(status_code=404, detail="Delivery not found")
    if delivery.status not in ("failed", "dead"):
        raise HTTPException(status_code=400, detail="Only failed or dead deliveries can be retried")
    # Reset attempt counter for manual retry
    delivery.attempt = 0
    await retry_delivery(db, delivery)
    db.refresh(delivery)
    return delivery


@router.post("/integrations/{integration_id}/retry-all")
async def bulk_retry(
    integration_id: str,
    db: Session = Depends(get_db),
):
    """Retry all failed/dead deliveries for an integration."""
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    failed_deliveries = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.integration_id == integration_id,
            WebhookDelivery.status.in_(["failed", "dead"]),
        )
        .all()
    )

    retried = 0
    succeeded = 0
    for delivery in failed_deliveries:
        delivery.attempt = 0
        result = await retry_delivery(db, delivery)
        retried += 1
        if result:
            succeeded += 1

    return {
        "retried": retried,
        "succeeded": succeeded,
        "failed": retried - succeeded,
    }


@router.delete("/deliveries", status_code=status.HTTP_204_NO_CONTENT)
def purge_old_deliveries(
    older_than_days: int = Query(30, ge=1),
    delivery_status: str | None = Query(None, alias="status", description="Only purge deliveries with this status"),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(UTC) - timedelta(days=older_than_days)
    q = db.query(WebhookDelivery).filter(WebhookDelivery.created_at < cutoff)
    if delivery_status:
        q = q.filter(WebhookDelivery.status == delivery_status)
    q.delete()
    db.commit()
