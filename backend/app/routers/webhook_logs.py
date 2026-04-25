from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Integration, WebhookDelivery
from app.schemas import WebhookDeliveryOut
from app.services.notifier import retry_delivery

router = APIRouter(tags=["webhook-logs"])


@router.get("/integrations/{integration_id}/deliveries", response_model=list[WebhookDeliveryOut])
def list_deliveries(
    integration_id: str,
    delivery_status: str | None = Query(None, alias="status"),
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
    return q.order_by(WebhookDelivery.created_at.desc()).offset(offset).limit(limit).all()


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


@router.delete("/deliveries", status_code=status.HTTP_204_NO_CONTENT)
def purge_old_deliveries(
    older_than_days: int = Query(30, ge=1),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    db.query(WebhookDelivery).filter(WebhookDelivery.created_at < cutoff).delete()
    db.commit()
