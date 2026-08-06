from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Integration
from app.schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate
from app.services.email_sender import is_configured as smtp_configured
from app.services.event_catalog import subscribable_events, validate_events
from app.services.integration_data import merge_secret_dict
from app.services.integration_templates import get_all_templates, get_template
from app.services.notifier import NOTIFICATION_SOURCES, fire_test_notification

router = APIRouter(prefix="/integrations", tags=["integrations"])

SMTP_WARNING = (
    "SMTP is not configured. Emails will not be sent until SMTP_HOST and SMTP_FROM environment variables are set."
)


def _validate_events_or_422(db: Session, events: list[str] | None) -> None:
    """422 on an event nothing delivers — matches what the Pydantic validator used to do."""
    try:
        validate_events(db, events)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    """Event types an integration can subscribe to.

    Served rather than hardcoded in the UI so the checkbox list cannot drift from the
    events the notifier actually delivers (ADR-0047). Includes the events the user's own
    active rules emit, so a custom event is subscribable as soon as something emits it
    (ADR-0048).
    """
    return subscribable_events(db)


@router.get("/sources")
def list_sources():
    """Causes an integration can narrow to (ADR-0048).

    Empty selection means every source, so this is a filter rather than a requirement.
    """
    return NOTIFICATION_SOURCES


@router.get("/templates")
def list_templates():
    """List available integration templates for popular CI/CD platforms."""
    return get_all_templates()


@router.get("/templates/{template_id}")
def get_template_detail(template_id: str):
    """Get full template details including setup instructions and example payloads."""
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.get("", response_model=list[IntegrationOut])
def list_integrations(db: Session = Depends(get_db)):
    return db.query(Integration).order_by(Integration.created_at.desc()).all()


@router.post("", response_model=IntegrationOut, status_code=status.HTTP_201_CREATED)
def create_integration(body: IntegrationCreate, db: Session = Depends(get_db)):
    _validate_events_or_422(db, body.events)
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
    if body.events is not None:
        _validate_events_or_422(db, body.events)
    patch = body.model_dump(exclude_none=True)
    # The credential dicts are merged, not replaced (ADR-0063). A client edits what it was
    # shown, and what it was shown has its credentials withheld as nulls — so replacing
    # wholesale would let "rename the basic-auth user" quietly delete the password.
    for field in ("auth_config", "custom_headers"):
        if field in patch:
            patch[field] = merge_secret_dict(getattr(integration, field), patch[field])
    for field, value in patch.items():
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
    result = await fire_test_notification(integration, db=db)
    return result
