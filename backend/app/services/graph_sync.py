"""Keep the graph mirror in sync with ORM mutations (ADR-0032).

A single ``before_flush`` listener mirrors entities into the ``nodes`` table:

* Entities (Project/Task/Identity/Goal) -> a ``nodes`` row of the matching
  type, with the hot columns (title/status/priority/dates/position/is_pinned)
  kept faithful to the entity. (``Label`` and ``Cycle`` are node-only, ADR-0033.)
* Updating an entity re-syncs its node hot columns.
* Deleting an entity drops its node and every touching edge.

Containment and every relationship live only in ``edges`` now; those are written
directly by their endpoints via the ``graph`` service (``create_task`` for
``contains``, ``set_label``/``add_to_cycle``/... for the rest), so this listener
no longer touches edges except to clean them up on entity deletion.
"""

import uuid

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import (
    Edge,
    Goal,
    Identity,
    Node,
    Project,
    Task,
)

# entity class -> node type
# ``label`` and ``cycle`` are intentionally absent: they collapsed to node-only
# in ADR-0033 Phase B and now flow through the generic graph layer.
_ENTITY_TYPES = {
    Project: "project",
    Task: "task",
    Identity: "identity",
    Goal: "goal",
}


def _title_of(obj) -> str:
    return getattr(obj, "title", None) or getattr(obj, "name", None) or ""


def _sync_hot_fields(node, obj) -> None:
    """Copy an entity's hot columns onto its node (mirrors the backfill mapping)."""
    node.title = _title_of(obj)
    if isinstance(obj, Project):
        node.status = obj.status
    elif isinstance(obj, Task):
        node.status = obj.status
        node.priority = obj.priority
        node.start_date = obj.start_date
        node.due_date = obj.due_date
        node.position = obj.position or 0
        node.is_pinned = bool(obj.is_pinned)
    elif isinstance(obj, Goal):
        node.status = obj.status
        node.due_date = obj.target_date
    # Identity carries only a title in the hot columns.
    # Label and Cycle are node-only (ADR-0033) and never reach this listener.


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


def _ensure_contains_edge(session, parent_id, parent_type, child_id):
    """Create a ``contains`` edge parent -> child, minting the parent node if absent."""
    if not parent_id:
        return
    if session.get(Node, parent_id) is None:
        session.add(Node(id=parent_id, type=parent_type, title=""))
    exists = (
        session.query(Edge)
        .filter(Edge.source_id == parent_id, Edge.target_id == child_id, Edge.rel_type == "contains")
        .first()
    )
    if exists is None:
        session.add(Edge(source_id=parent_id, target_id=child_id, rel_type="contains"))


@event.listens_for(Session, "before_flush")
def _mirror(session, flush_context, instances):
    seen_nodes: set[str] = set()

    # 1. New entities -> nodes. Tasks also get their containment ``contains`` edges
    #    from the transient project_id/parent_id constructor hints (ADR-0032).
    for obj in session.new:
        node_type = _ENTITY_TYPES.get(type(obj))
        if node_type is None:
            continue
        if obj.id is None:
            obj.id = str(uuid.uuid4())  # pin the pk now so edges can reference it
        _upsert_node(session, seen_nodes, obj, node_type)
        if isinstance(obj, Task):
            _ensure_contains_edge(session, getattr(obj, "_graph_project_id", None), "project", obj.id)
            _ensure_contains_edge(session, getattr(obj, "_graph_parent_id", None), "task", obj.id)

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
