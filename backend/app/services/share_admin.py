"""Every write a share panel makes, for both doors (ADR-0087).

ADR-0070→0073 collapsed sharing onto one panel, one public page, one data endpoint and one
calendar feed, because a drifted copy of the share panel had handed users two different
links for one share. The *write* surface was collapsed too — for the SPA. When ``/api/v1``
grew a share facade (ADR-0042) it was written fresh alongside, minting its own token with
its own ``uuid4()`` and repeating each rule.

Nothing had broken yet, which is exactly the state ADR-0070 warns about: a duplicate that
still works has no failure symptom, and ADR-0072 was the bill for the last one — a
project-share PIN that could be *set* and was silently ignored, because the capability was
granted by role and only one consumer of that role implemented it.

So the rules live here: what may be shared, what a PIN must look like, how an expiry is
stored. Each router keeps only its 404 and who is allowed to ask.
"""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph
from app.services.activity import share_view_count
from app.services.errors import Invalid, NotFound

PIN_MIN, PIN_MAX = 4, 6


def load(db: Session, node_id: str) -> Node:
    """The node, or the refusal — 404 for absent, 400 for a type that cannot be shared."""
    node = db.get(Node, node_id)
    if node is None:
        raise NotFound("node not found")
    if not graph.node_is_shareable(db, node):
        raise Invalid("node type is not shareable")
    return node


def rotate_token(db: Session, node_id: str) -> dict:
    """Issue a new share token. The old link — and its calendar feed — stop resolving.

    One place mints it, so the two doors cannot hand out tokens from two generators.
    """
    token = str(uuid.uuid4())
    graph.update_node(db, node_id, share_token=token)
    db.commit()
    return {"share_token": token}


def set_pin(db: Session, node_id: str, pin: str) -> dict:
    from app.services.pin_utils import hash_pin

    if not pin or not (PIN_MIN <= len(pin) <= PIN_MAX) or not pin.isdigit():
        raise Invalid(f"PIN must be {PIN_MIN}-{PIN_MAX} digits")
    graph.update_node(db, node_id, share_pin_hash=hash_pin(pin))
    db.commit()
    return {"ok": True}


def clear_pin(db: Session, node_id: str) -> dict:
    graph.update_node(db, node_id, share_pin_hash=None)
    db.commit()
    return {"ok": True}


def set_expiry(db: Session, node_id: str, expires_at: datetime | None) -> dict:
    # Stored as an ISO string in node.data (update_node does not encode datetimes).
    graph.update_node(db, node_id, share_expires_at=expires_at.isoformat() if expires_at else None)
    db.commit()
    return {"ok": True}


def set_guest_notes(db: Session, node_id: str, allowed: bool) -> dict:
    """Let (or stop letting) visitors leave notes on this node's share page (ADR-0016)."""
    graph.update_node(db, node_id, allow_guest_notes=allowed)
    db.commit()
    return {"ok": True}


def view_count(db: Session, node_id: str) -> dict:
    # Matches rows written under identity_id / project_id / node_id alike: retiring a route
    # must not retire its history (ADR-0073).
    return {"view_count": share_view_count(db, node_id)}
