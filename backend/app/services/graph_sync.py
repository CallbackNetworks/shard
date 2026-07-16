"""Keep the graph mirror in sync with ORM mutations (ADR-0032).

A single ``before_flush`` listener mirrors both entities and relationships into
the ``nodes`` / ``edges`` tables, so write sites across the codebase stay
mirrored without being individually patched:

* Entities (Project/Task/Identity/Goal/Cycle/Label) -> a ``nodes`` row of the
  matching type, with the hot columns (title/status/priority/dates/position/
  is_pinned) kept faithful to the entity. Tasks also get their ``contains``
  edges from project_id/parent_id.
* Updating an entity re-syncs its node hot columns; re-parenting a task
  (project_id/parent_id change) moves the corresponding ``contains`` edge.
* Deleting an entity drops its node and every touching edge.

All relationships (dependencies, labels, cycle membership, identity membership,
goal membership) are written directly as edges by their endpoints via the
``graph`` service, so only the entity/containment mirror remains here.

Edge direction matches the backfill migration (source -> target); the hot-field
mapping mirrors ``d2e4f6a8c0b2_backfill_nodes_and_edges``.

Known limitation (handled when the read path is cut over to edges):
* Bulk ORM operations (``query(...).delete()`` / ``update()``) bypass the unit
  of work and therefore this listener; those sites call ``graph`` helpers.
"""

import uuid

from sqlalchemy import event, inspect
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
    elif isinstance(obj, Cycle):
        node.status = obj.status
        node.start_date = obj.start_date
        node.due_date = obj.end_date
    # Identity and Label carry only a title in the hot columns.


def _upsert_node(session, seen_nodes, node_id, node_type, *, obj=None, title=""):
    """Ensure a node of the given type exists, creating a minimal one if absent.

    When ``obj`` is given, the entity's hot columns are synced onto the node.
    """
    if not node_id or node_id in seen_nodes:
        return
    seen_nodes.add(node_id)
    node = session.get(Node, node_id)
    if node is None:
        node = Node(id=node_id, type=node_type, title=title or (_title_of(obj) if obj is not None else ""))
        session.add(node)
    if obj is not None:
        _sync_hot_fields(node, obj)
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


def _ensure_node_and_edge(session, seen_nodes, seen_edges, parent_id, parent_type, child_id):
    """Add a ``contains`` edge parent -> child, ensuring the parent node exists."""
    if not parent_id:
        return
    _upsert_node(session, seen_nodes, parent_id, parent_type)
    _ensure_edge(session, seen_edges, parent_id, child_id, "contains")


def _reparent(session, seen_nodes, seen_edges, task) -> None:
    """Move a task's ``contains`` edge(s) when project_id/parent_id changed."""
    state = inspect(task)
    for attr, parent_type in (("project_id", "project"), ("parent_id", "task")):
        history = state.attrs[attr].history
        if not history.has_changes():
            continue
        for old_id in history.deleted:
            if old_id:
                session.query(Edge).filter(
                    Edge.source_id == old_id, Edge.target_id == task.id, Edge.rel_type == "contains"
                ).delete(synchronize_session=False)
        new_id = history.added[0] if history.added else None
        _ensure_node_and_edge(session, seen_nodes, seen_edges, new_id, parent_type, task.id)


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
        _upsert_node(session, seen_nodes, obj.id, node_type, obj=obj)
        if isinstance(obj, Task):
            _ensure_node_and_edge(session, seen_nodes, seen_edges, obj.project_id, "project", obj.id)
            _ensure_node_and_edge(session, seen_nodes, seen_edges, obj.parent_id, "task", obj.id)

    # 2. Updated entities -> re-sync node hot fields (+ move task containment edges).
    for obj in session.dirty:
        node_type = _ENTITY_TYPES.get(type(obj))
        if node_type is None:
            continue
        _upsert_node(session, seen_nodes, obj.id, node_type, obj=obj)
        if isinstance(obj, Task):
            _reparent(session, seen_nodes, seen_edges, obj)

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
