"""What an integration is allowed to subscribe to, and what a rule may trigger on (ADR-0048, ADR-0106).

ADR-0047 made ``NOTIFICATION_EVENTS`` the single list of events the platform delivers,
which closed the "advertised but never fired" gap. It left the mirror image open: a rule's
``fire_event`` action takes a free string, so a user can emit ``deploy.requested`` and then
be told 422 when they try to subscribe to it. The subscribable vocabulary is therefore the
built-in list *plus* whatever the user's own active rules emit — derived at read time from
the rules themselves, so there is no second place to keep in sync and no table to migrate.

ADR-0106 reuses this same list as a second thing: a *trigger*, not only a subscription. A
rule's ``trigger`` may be a structural trigger (``rules_engine.SUPPORTED_TRIGGERS``) or a
named event, so the frontend has one merged picker instead of two vocabularies for what a
rule can react to.
"""

from sqlalchemy.orm import Session

from app.models import WorkflowRule
from app.services.notifier import NOTIFICATION_EVENTS
from app.services.rules_engine import SUPPORTED_TRIGGERS

# Events a rule emits are user-defined strings; keep them recognisable as event names so
# the UI can group them by prefix the same way it groups the built-ins.
_MAX_EVENT_LEN = 100

# NOTIFICATION_EVENTS minus "rule.triggered": that one event is fired exclusively from
# inside rule execution (``rules_engine._fire``, always ``source="rule"``), so it can never
# satisfy the chain-prevention guard in ``notifier._deliver`` (ADR-0048/ADR-0106) — offering
# it as a trigger would be a trigger that looks healthy and never runs, the exact class of
# bug ADR-0047/0048's own guards exist to catch. Custom ``fire_event`` names are excluded
# from triggers for the identical reason: by construction they are only ever emitted by a
# rule's own action, so they are permanently unfireable as a trigger too.
TRIGGERABLE_EVENTS = [e for e in NOTIFICATION_EVENTS if e != "rule.triggered"]


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


def subscribable_triggers(db: Session) -> list[str]:
    """Every value a rule's ``trigger`` may hold: structural, then named events (ADR-0106).

    Deliberately narrower than ``subscribable_events``: custom ``fire_event`` names are not
    included here, because they can only ever originate from a rule action, so they could
    never satisfy the chain-prevention guard and would be a trigger nothing could ever fire.
    """
    return list(SUPPORTED_TRIGGERS) + TRIGGERABLE_EVENTS


def validate_trigger(db: Session, trigger: str) -> str:
    """Return ``trigger`` if it is a structural trigger or a triggerable event, else raise.

    Same shape as ``validate_events``: an unknown trigger is a rule that would sit in the
    list looking healthy and never run (ADR-0047/0048/0106).
    """
    allowed = subscribable_triggers(db)
    if trigger not in allowed:
        raise ValueError(f"unknown trigger '{trigger}'; expected one of {', '.join(sorted(allowed))}")
    return trigger
