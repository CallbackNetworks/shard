"""Identities (node-only, ADR-0033 Phase B).

An identity is a ``Node(type="identity")``: ``title`` = name and every other
field (color/description/avatar/share_token/share_pin_hash/share_expires_at/
allow_guest_notes) lives in ``data`` -- identities carry only a title in the hot
columns. Like goals they are top-level (projects attach via ``owns``
edges), so there is no containing ``contains`` edge. ``share_expires_at`` is a
datetime stored as an ISO string in JSON. ``IdentityView`` exposes the historical
``Identity`` attribute surface so ``IdentityOut.model_validate`` keeps working.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node, NodeType
from app.services.graph.core import (
    NODE_IDENTITY,
    NODE_PROJECT,
    REL_OWNS,
    _iso,
    _parse_dt,
    add_edge,
    container_type_keys,
    create_node,
    delete_node,
    ensure_node,
    reachable_project_ids,
    remove_edge,
)
from app.services.graph.projects import ProjectView, projects_by_ids


def link_membership(db: Session, identity_id: str, project_id: str) -> None:
    """Attach an identity to a project as a ``owns`` edge (idempotent)."""
    ensure_node(db, identity_id, NODE_IDENTITY)
    ensure_node(db, project_id, NODE_PROJECT)
    add_edge(db, identity_id, project_id, REL_OWNS)


def unlink_membership(db: Session, identity_id: str, project_id: str) -> bool:
    return remove_edge(db, identity_id, project_id, REL_OWNS)


def project_ids_for_identity(db: Session, identity_id: str) -> list[str]:
    rows = db.execute(select(Edge.target_id).where(Edge.source_id == identity_id, Edge.rel_type == REL_OWNS)).scalars()
    return list(rows)


def identity_ids_for_project(db: Session, project_id: str) -> list[str]:
    rows = db.execute(select(Edge.source_id).where(Edge.target_id == project_id, Edge.rel_type == REL_OWNS)).scalars()
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
    """Create a top-level identity node (projects attach via ``owns``).

    ``share_token`` is seeded by the write core for any shareable-role type
    (ADR-0041 B); the remaining share fields default to absent (read as None/False).
    """
    node = create_node(
        db,
        NODE_IDENTITY,
        title=name,
        actor=actor,
        color=color,
        description=description,
        avatar=avatar,
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
    """Delete an identity node and every edge touching it (``owns``)."""
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


@dataclass
class FocusTargetView:
    id: str
    name: str
    type: str
    type_label: str
    color: str | None
    avatar: str | None
    project_ids: list[str]
    project_count: int


def all_focus_targets(db: Session) -> list[FocusTargetView]:
    """Every node the sidebar Focus control can narrow by (ADR-0081): every identity,
    plus every non-project container-role node (e.g. a custom ``organization`` type) —
    each with the project ids reachable from it via ``contains``/``owns``.

    Container-role eligibility is registry-driven (``container_type_keys``, ADR-0040),
    so a new custom container type becomes a valid focus target with no code change.
    """
    eligible_types = {NODE_IDENTITY, *(container_type_keys(db) - {NODE_PROJECT})}
    nodes = db.query(Node).filter(Node.type.in_(eligible_types)).order_by(Node.created_at.asc()).all()
    type_rows = {nt.key: nt for nt in db.query(NodeType).filter(NodeType.key.in_(eligible_types)).all()}

    targets = []
    for node in nodes:
        data = node.data or {}
        nt = type_rows.get(node.type)
        project_ids = sorted(reachable_project_ids(db, node.id))
        targets.append(
            FocusTargetView(
                id=node.id,
                name=node.title,
                type=node.type,
                type_label=nt.label if nt else node.type,
                # A node's own data.color wins (e.g. identity, which declares a per-node
                # color field); most container types have no such field, so fall back to
                # the type's registry color rather than leaving the picker uncolored.
                color=data.get("color") or (nt.color if nt else None),
                avatar=data.get("avatar"),
                project_ids=project_ids,
                project_count=len(project_ids),
            )
        )
    return targets
