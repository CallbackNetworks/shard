"""Keep the graph mirror in sync with ORM mutations (ADR-0032/0033).

A single ``before_flush`` listener mirrors the remaining entity-backed type
(``Project``) into the ``nodes`` table:

* A new/updated ``Project`` -> a ``nodes`` row of type ``project`` with its hot
  columns (title/status) kept faithful to the entity.
* Deleting a ``Project`` drops its node and every touching edge.

Every other type (Label/Cycle/Goal/Identity/Task) is node-only (ADR-0033) and
flows through the generic ``graph`` service directly; containment and every
relationship live only in ``edges``.
"""

import uuid

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import (
    Edge,
    Node,
    Project,
)

# entity class -> node type. Only ``project`` remains entity-backed; task
# collapsed to node-only in ADR-0033 Phase B (B5) and flows through the graph layer.
_ENTITY_TYPES = {
    Project: "project",
}


def _title_of(obj) -> str:
    return getattr(obj, "title", None) or getattr(obj, "name", None) or ""


def _sync_hot_fields(node, obj) -> None:
    """Copy an entity's hot columns onto its node (mirrors the backfill mapping)."""
    node.title = _title_of(obj)
    if isinstance(obj, Project):
        node.status = obj.status
    # Label/Cycle/Goal/Identity/Task are node-only (ADR-0033) and never reach here.


def _upsert_node(session, seen_nodes, obj, node_type):
    """Ensure the entity's node exists and its hot columns are in sync."""
    if not obj.id or obj.id in seen_nodes:
        return
    seen_nodes.add(obj.id)
    node = session.get(Node, obj.id)
    if node is None:
        node = Node(id=obj.id, type=node_type, title=_title_of(obj))
        session.add(node)
    _sync_hot_fields(node, obj)


@event.listens_for(Session, "before_flush")
def _mirror(session, flush_context, instances):
    seen_nodes: set[str] = set()

    # 1. New entities -> nodes.
    for obj in session.new:
        node_type = _ENTITY_TYPES.get(type(obj))
        if node_type is None:
            continue
        if obj.id is None:
            obj.id = str(uuid.uuid4())  # pin the pk now so edges can reference it
        _upsert_node(session, seen_nodes, obj, node_type)

    # 2. Updated entities -> re-sync node hot fields.
    for obj in session.dirty:
        node_type = _ENTITY_TYPES.get(type(obj))
        if node_type is None:
            continue
        _upsert_node(session, seen_nodes, obj, node_type)

    # 3. Deleted entities -> drop their node and every touching edge.
    for obj in session.deleted:
        if type(obj) in _ENTITY_TYPES:
            # Explicitly clear touching edges — SQLite does not enforce ondelete CASCADE.
            session.query(Edge).filter((Edge.source_id == obj.id) | (Edge.target_id == obj.id)).delete(
                synchronize_session=False
            )
            node = session.get(Node, obj.id)
            if node is not None:
                session.delete(node)
