from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Integration
from app.schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate
from app.services.email_sender import is_configured as smtp_configured
from app.services.notifier import fire_test_notification

router = APIRouter(prefix="/integrations", tags=["integrations"])

SMTP_WARNING = (
    "SMTP is not configured. Emails will not be sent until SMTP_HOST and SMTP_FROM environment variables are set."
)


@router.get("", response_model=list[IntegrationOut])
def list_integrations(db: Session = Depends(get_db)):
    return db.query(Integration).order_by(Integration.created_at.desc()).all()


@router.post("", response_model=IntegrationOut, status_code=status.HTTP_201_CREATED)
def create_integration(body: IntegrationCreate, db: Session = Depends(get_db)):
    integration = Integration(**body.model_dump())
    db.add(integration)
    db.commit()
    db.refresh(integration)
    result = IntegrationOut.model_validate(integration)
    if integration.type == "email" and not smtp_configured():
        result.smtp_warning = SMTP_WARNING
    return result


@router.patch("/{integration_id}", response_model=IntegrationOut)
def update_integration(integration_id: str, body: IntegrationUpdate, db: Session = Depends(get_db)):
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(integration, field, value)
    db.commit()
    db.refresh(integration)
    result = IntegrationOut.model_validate(integration)
    if integration.type == "email" and not smtp_configured():
        result.smtp_warning = SMTP_WARNING
    return result


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_integration(integration_id: str, db: Session = Depends(get_db)):
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    db.delete(integration)
    db.commit()


@router.post("/{integration_id}/test")
async def test_integration(integration_id: str, db: Session = Depends(get_db)):
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    result = await fire_test_notification(integration)
    return result
