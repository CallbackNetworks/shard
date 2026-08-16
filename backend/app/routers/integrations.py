"""Outbound integrations for the SPA.

Thin over ``services/integration_admin``, which ``/api/v1/integrations`` calls too
(ADR-0085).
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate
from app.services import integration_admin

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/events")
def list_events(db: Session = Depends(get_db)):
    return integration_admin.events_catalog(db)


@router.get("/sources")
def list_sources():
    return integration_admin.sources_catalog()


@router.get("/templates")
def list_templates():
    """List available integration templates for popular CI/CD platforms."""
    return integration_admin.templates_catalog()


@router.get("/templates/{template_id}")
def get_template_detail(template_id: str):
    """Get full template details including setup instructions and example payloads."""
    return integration_admin.template(template_id)


@router.get("", response_model=list[IntegrationOut])
def list_integrations(db: Session = Depends(get_db)):
    return integration_admin.list_integrations(db)


@router.post("", response_model=IntegrationOut, status_code=status.HTTP_201_CREATED)
def create_integration(body: IntegrationCreate, db: Session = Depends(get_db)):
    return integration_admin.create(db, body)


@router.patch("/{integration_id}", response_model=IntegrationOut)
def update_integration(integration_id: str, body: IntegrationUpdate, db: Session = Depends(get_db)):
    return integration_admin.update(db, integration_id, body)


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_integration(integration_id: str, db: Session = Depends(get_db)):
    integration_admin.delete(db, integration_id)


@router.post("/{integration_id}/test")
async def test_integration(integration_id: str, db: Session = Depends(get_db)):
    return await integration_admin.test(db, integration_id)
