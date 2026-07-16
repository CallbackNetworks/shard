"""Keep the graph mirror in sync with ORM mutations (ADR-0032).

A single ``before_flush`` listener mirrors both entities and relationships into
the ``nodes`` / ``edges`` tables, so write sites across the codebase stay
mirrored without being individually patched:

* Entities (Project/Task/Identity/Goal/Cycle/Label) -> a ``nodes`` row of the
  matching type. Tasks also get their ``contains`` edges from project_id/parent_id.
  Deleting an entity drops its node and every touching edge.

All relationships (dependencies, labels, cycle membership, identity membership,
goal membership) are now written directly as edges by their endpoints via the
``graph`` service, so only the entity/containment mirror remains here.

Edge direction matches the backfill migration (source -> target).

Known limitations (handled when the read path is cut over to edges):
* Bulk ORM operations (``query(...).delete()`` / ``update()``) bypass the unit
  of work and therefore this listener.
* Entity field updates (title/status) and task re-parenting are not re-synced
  yet; node hot-fields are not read from the graph at this stage.
"""

import uuid

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import (
    Cycle,
    Edge,
    Goal,
    Identity,
    Label,
    Node,
    Project,
    Task,
)

# entity class -> node type
_ENTITY_TYPES = {
    Project: "project",
    Task: "task",
    Identity: "identity",
    Goal: "goal",
    Cycle: "cycle",
    Label: "label",
}


def _title_of(obj) -> str:
    return getattr(obj, "title", None) or getattr(obj, "name", None) or ""


def _upsert_node(session, seen_nodes, node_id, node_type, title=""):
    """Ensure a node of the given type exists, creating a minimal one if absent."""
    if not node_id or node_id in seen_nodes:
        return
    seen_nodes.add(node_id)
    node = session.get(Node, node_id)
    if node is None:
        session.add(Node(id=node_id, type=node_type, title=title))
    elif title and not node.title:
        node.title = title


def _ensure_edge(session, seen_edges, source_id, target_id, rel_type):
    if not source_id or not target_id:
        return
    key = (source_id, target_id, rel_type)
    if key in seen_edges:
        return
    seen_edges.add(key)
    existing = (
        session.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .first()
    )
    if existing is None:
        session.add(Edge(source_id=source_id, target_id=target_id, rel_type=rel_type))


@event.listens_for(Session, "before_flush")
def _mirror(session, flush_context, instances):
    seen_nodes: set[str] = set()
    seen_edges: set[tuple] = set()

    # 1. New entities -> nodes (+ task containment edges).
    for obj in session.new:
        node_type = _ENTITY_TYPES.get(type(obj))
        if node_type is None:
            continue
        if obj.id is None:
            obj.id = str(uuid.uuid4())  # pin the pk now so the mirror can reference it
        _upsert_node(session, seen_nodes, obj.id, node_type, _title_of(obj))
        if isinstance(obj, Task):
            _ensure_node_and_edge(session, seen_nodes, seen_edges, obj.project_id, "project", obj.id)
            _ensure_node_and_edge(session, seen_nodes, seen_edges, obj.parent_id, "task", obj.id)

    # 2. Deleted entities -> drop their node and every touching edge.
    for obj in session.deleted:
        if type(obj) in _ENTITY_TYPES:
            # Explicitly clear touching edges — SQLite does not enforce ondelete CASCADE.
            session.query(Edge).filter((Edge.source_id == obj.id) | (Edge.target_id == obj.id)).delete(
                synchronize_session=False
            )
            node = session.get(Node, obj.id)
            if node is not None:
                session.delete(node)


def _ensure_node_and_edge(session, seen_nodes, seen_edges, parent_id, parent_type, child_id):
    """Add a ``contains`` edge parent -> child, ensuring the parent node exists."""
    if not parent_id:
        return
    _upsert_node(session, seen_nodes, parent_id, parent_type)
    _ensure_edge(session, seen_edges, parent_id, child_id, "contains")
