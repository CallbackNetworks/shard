"""Outbound integrations: the act, for both doors (ADR-0085).

``/api/v1`` already let an agent register an outbound callback — but only through
``/subscriptions``, which is this with three things nailed shut: the type is always
``webhook``, the name is always prefixed ``agent:{key}:``, and everything an email
integration or a signed/authenticated webhook needs (``secret``, ``auth_config``,
``custom_headers``, templates, a test fire) is unreachable. So "an agent may configure its
own notifications" was already the accepted position, and the *general* form of it was
still browser-only.

Scope follows that precedent rather than inventing a stricter one: ``/subscriptions``
writes have always required ``write``, and an integration created here is the same object
with the same reach. Making the general door ``admin`` while the sugar over it stays
``write`` would be two answers to one question — the exact defect ADR-0079 named.

The credential rules are ADR-0063's and are not relaxed by a second door: ``IntegrationOut``
withholds ``secret``/``auth_config``/``custom_headers`` on the way out for every caller, and
``merge_secret_dict`` means a ``null`` on the way in is "unchanged" rather than "delete".
"""

from sqlalchemy.orm import Session

from app.models import Integration
from app.schemas import IntegrationCreate, IntegrationOut, IntegrationUpdate
from app.services.email_sender import is_configured as smtp_configured
from app.services.errors import NotFound, Unprocessable
from app.services.event_catalog import subscribable_events, validate_events
from app.services.integration_data import merge_secret_dict
from app.services.integration_templates import get_all_templates, get_template
from app.services.notifier import NOTIFICATION_SOURCES, fire_test_notification

SMTP_WARNING = (
    "SMTP is not configured. Emails will not be sent until SMTP_HOST and SMTP_FROM environment variables are set."
)


def _check_events(db: Session, events: list[str] | None) -> None:
    """422 on an event nothing delivers (ADR-0047)."""
    try:
        validate_events(db, events)
    except ValueError as exc:
        raise Unprocessable(str(exc)) from exc


def _out(integration: Integration) -> IntegrationOut:
    result = IntegrationOut.model_validate(integration)
    if integration.type == "email" and not smtp_configured():
        result.smtp_warning = SMTP_WARNING
    return result


def events_catalog(db: Session) -> list:
    """Event types an integration can subscribe to, including ones the user's own active
    rules emit (ADR-0047, ADR-0048). Served rather than hardcoded so a subscriber list
    cannot drift from what the notifier delivers."""
    return subscribable_events(db)


def sources_catalog() -> list:
    """Causes an integration can narrow to (ADR-0048). Empty selection means every source."""
    return NOTIFICATION_SOURCES


def templates_catalog() -> list:
    return get_all_templates()


def template(template_id: str) -> dict:
    found = get_template(template_id)
    if not found:
        raise NotFound("Template not found")
    return found


def load(db: Session, integration_id: str) -> Integration:
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise NotFound("Integration not found")
    return integration


def list_integrations(db: Session, *, project_id: str | None = None) -> list[IntegrationOut]:
    q = db.query(Integration)
    if project_id:
        # An unscoped integration receives events from every project, so it belongs in the
        # answer for any one of them — leaving it out is how ADR-0047's silent-empty-set bug
        # read from the other side.
        q = q.filter((Integration.project_id == project_id) | (Integration.project_id == None))
    return [_out(i) for i in q.order_by(Integration.created_at.desc()).all()]


def create(db: Session, body: IntegrationCreate) -> IntegrationOut:
    _check_events(db, body.events)
    integration = Integration(**body.model_dump())
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return _out(integration)


def update(db: Session, integration_id: str, body: IntegrationUpdate) -> IntegrationOut:
    integration = load(db, integration_id)
    if body.events is not None:
        _check_events(db, body.events)
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
    return _out(integration)


def delete(db: Session, integration_id: str) -> None:
    integration = load(db, integration_id)
    db.delete(integration)
    db.commit()


async def test(db: Session, integration_id: str) -> dict:
    """Fire a test notification and report what the target said."""
    return await fire_test_notification(load(db, integration_id), db=db)
