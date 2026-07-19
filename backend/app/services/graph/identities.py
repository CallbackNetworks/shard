"""Identities (node-only, ADR-0033 Phase B).

An identity is a ``Node(type="identity")``: ``title`` = name and every other
field (color/description/avatar/share_token/share_pin_hash/share_expires_at/
allow_guest_notes) lives in ``data`` -- identities carry only a title in the hot
columns. Like goals they are top-level (projects attach via ``member_of``
edges), so there is no containing ``contains`` edge. ``share_expires_at`` is a
datetime stored as an ISO string in JSON. ``IdentityView`` exposes the historical
``Identity`` attribute surface so ``IdentityOut.model_validate`` keeps working.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.graph.core import (
    NODE_IDENTITY,
    NODE_PROJECT,
    REL_MEMBER_OF,
    _iso,
    _parse_dt,
    add_edge,
    create_node,
    delete_node,
    ensure_node,
    remove_edge,
)
from app.services.graph.projects import ProjectView, projects_by_ids


def link_membership(db: Session, identity_id: str, project_id: str) -> None:
    """Attach an identity to a project as a ``member_of`` edge (idempotent)."""
    ensure_node(db, identity_id, NODE_IDENTITY)
    ensure_node(db, project_id, NODE_PROJECT)
    add_edge(db, identity_id, project_id, REL_MEMBER_OF)


def unlink_membership(db: Session, identity_id: str, project_id: str) -> bool:
    return remove_edge(db, identity_id, project_id, REL_MEMBER_OF)


def project_ids_for_identity(db: Session, identity_id: str) -> list[str]:
    rows = db.execute(
        select(Edge.target_id).where(Edge.source_id == identity_id, Edge.rel_type == REL_MEMBER_OF)
    ).scalars()
    return list(rows)


def identity_ids_for_project(db: Session, project_id: str) -> list[str]:
    rows = db.execute(
        select(Edge.source_id).where(Edge.target_id == project_id, Edge.rel_type == REL_MEMBER_OF)
    ).scalars()
    return list(rows)


def projects_for_identity(db: Session, identity_id: str) -> list[ProjectView]:
    ids = project_ids_for_identity(db, identity_id)
    if not ids:
        return []
    by_id = projects_by_ids(db, ids)
    return [by_id[i] for i in ids if i in by_id]


@dataclass
class IdentityView:
    id: str
    name: str
    color: str
    description: str | None
    avatar: str | None
    share_token: str | None
    share_pin_hash: str | None
    share_expires_at: datetime | None
    allow_guest_notes: bool
    created_at: datetime


def _identity_view(node: Node) -> IdentityView:
    data = node.data or {}
    return IdentityView(
        id=node.id,
        name=node.title,
        color=data.get("color", "#5e6ad2"),
        description=data.get("description"),
        avatar=data.get("avatar"),
        share_token=data.get("share_token"),
        share_pin_hash=data.get("share_pin_hash"),
        share_expires_at=_parse_dt(data.get("share_expires_at")),
        allow_guest_notes=bool(data.get("allow_guest_notes", False)),
        created_at=node.created_at,
    )


def create_identity(
    db: Session,
    *,
    name: str,
    color: str = "#5e6ad2",
    description: str | None = None,
    avatar: str | None = None,
    actor: str | None = None,
) -> IdentityView:
    """Create a top-level identity node (projects attach via ``member_of``)."""
    node = create_node(
        db,
        NODE_IDENTITY,
        title=name,
        actor=actor,
        color=color,
        description=description,
        avatar=avatar,
        share_token=str(uuid.uuid4()),
        share_pin_hash=None,
        share_expires_at=None,
        allow_guest_notes=False,
    )
    return _identity_view(node)


def update_identity(db: Session, identity_id: str, **fields) -> IdentityView | None:
    """Update an identity node; ``name``->title, everything else into ``data``."""
    node = db.get(Node, identity_id)
    if node is None or node.type != NODE_IDENTITY:
        return None
    if "name" in fields:
        node.title = fields.pop("name")
    data = dict(node.data or {})
    for key, value in fields.items():
        data[key] = _iso(value)
    node.data = data or None
    db.flush()
    return _identity_view(node)


def delete_identity(db: Session, identity_id: str, *, actor: str | None = None) -> bool:
    """Delete an identity node and every edge touching it (member_of, assigned_to)."""
    node = db.get(Node, identity_id)
    if node is None or node.type != NODE_IDENTITY:
        return False
    return delete_node(db, identity_id, actor=actor)


def get_identity(db: Session, identity_id: str) -> IdentityView | None:
    node = db.get(Node, identity_id)
    if node is None or node.type != NODE_IDENTITY:
        return None
    return _identity_view(node)


def all_identities(db: Session) -> list[IdentityView]:
    """All identity nodes, oldest first."""
    rows = db.query(Node).filter(Node.type == NODE_IDENTITY).order_by(Node.created_at.asc()).all()
    return [_identity_view(node) for node in rows]


def find_identity_by_share_token(db: Session, token: str) -> IdentityView | None:
    """Locate an identity by its ``share_token`` (stored in ``data``).

    Scans identity nodes and filters in Python: the token lives in the JSON
    ``data`` bag (no indexed column) and identity counts are small.
    """
    for node in db.query(Node).filter(Node.type == NODE_IDENTITY).all():
        if (node.data or {}).get("share_token") == token:
            return _identity_view(node)
    return None


def identities_for_project(db: Session, project_id: str) -> list[IdentityView]:
    ids = identity_ids_for_project(db, project_id)
    if not ids:
        return []
    by_id = {n.id: n for n in db.query(Node).filter(Node.id.in_(ids), Node.type == NODE_IDENTITY).all()}
    return [_identity_view(by_id[i]) for i in ids if i in by_id]
