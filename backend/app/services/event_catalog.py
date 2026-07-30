"""What an integration is allowed to subscribe to (ADR-0048).

ADR-0047 made ``NOTIFICATION_EVENTS`` the single list of events the platform delivers,
which closed the "advertised but never fired" gap. It left the mirror image open: a rule's
``fire_event`` action takes a free string, so a user can emit ``deploy.requested`` and then
be told 422 when they try to subscribe to it. The subscribable vocabulary is therefore the
built-in list *plus* whatever the user's own active rules emit — derived at read time from
the rules themselves, so there is no second place to keep in sync and no table to migrate.
"""

from sqlalchemy.orm import Session

from app.models import WorkflowRule
from app.services.notifier import NOTIFICATION_EVENTS

# Events a rule emits are user-defined strings; keep them recognisable as event names so
# the UI can group them by prefix the same way it groups the built-ins.
_MAX_EVENT_LEN = 100


def custom_events(db: Session) -> list[str]:
    """Event names emitted by ``fire_event`` actions on active rules.

    Only active rules count: deactivating the rule that emits an event stops it being
    offered, which is the same reasoning as not advertising an event nobody fires.
    """
    builtin = set(NOTIFICATION_EVENTS)
    names: set[str] = set()
    rules = db.query(WorkflowRule).filter(WorkflowRule.active == True).all()  # noqa: E712
    for rule in rules:
        for action in rule.actions or []:
            if action.get("type") != "fire_event":
                continue
            value = (action.get("value") or "").strip()
            if value and value not in builtin and len(value) <= _MAX_EVENT_LEN:
                names.add(value)
    return sorted(names)


def subscribable_events(db: Session) -> list[str]:
    """The full vocabulary: built-in events first, then the user's own rule events."""
    return list(NOTIFICATION_EVENTS) + custom_events(db)


def validate_events(db: Session, events: list[str] | None) -> list[str]:
    """Return ``events`` if every entry is subscribable, else raise ValueError.

    Subscribing to an event nobody fires is a checkbox that does nothing and never says
    so, which is the bug class this whole area keeps producing (ADR-0046, ADR-0047).
    """
    if not events:
        return events or []
    allowed = subscribable_events(db)
    invalid = [e for e in events if e not in allowed]
    if invalid:
        raise ValueError(
            f"unknown event {', '.join(sorted(invalid))}; expected one of {', '.join(sorted(allowed))}"
            " (a custom event becomes subscribable once an active rule fires it)"
        )
    return events
