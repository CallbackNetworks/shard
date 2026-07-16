"""Keep the graph mirror in sync with ORM mutations (ADR-0032).

A single ``before_flush`` listener mirrors both entities and relationships into
the ``nodes`` / ``edges`` tables, so write sites across the codebase stay
mirrored without being individually patched:

* Entities (Project/Task/Identity/Goal/Cycle/Label) -> a ``nodes`` row of the
  matching type. Tasks also get their ``contains`` edges from project_id/parent_id.
* Association objects (CycleTask/ProjectIdentity/GoalProject) -> the matching
  ``edges`` row. (Dependencies and labels are written directly as edges by their
  endpoints, so they are not mirrored here.)

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
    CycleTask,
    Edge,
    Goal,
    GoalProject,
    Identity,
    Label,
    Node,
    Project,
    ProjectIdentity,
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

# association class -> (source_attr, target_attr, rel_type, source_node_type, target_node_type)
# Dependencies and labels are written directly as edges (no association table), so
# they are not listed here.
_ASSOC_SPECS = {
    CycleTask: ("task_id", "cycle_id", "in_cycle", "task", "cycle"),
    ProjectIdentity: ("identity_id", "project_id", "member_of", "identity", "project"),
    GoalProject: ("project_id", "goal_id", "part_of", "project", "goal"),
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

    # 2. New associations -> edges.
    for obj in session.new:
        spec = _ASSOC_SPECS.get(type(obj))
        if spec is None:
            continue
        src_attr, tgt_attr, rel_type, src_type, tgt_type = spec
        source_id = getattr(obj, src_attr)
        target_id = getattr(obj, tgt_attr)
        _upsert_node(session, seen_nodes, source_id, src_type)
        _upsert_node(session, seen_nodes, target_id, tgt_type)
        _ensure_edge(session, seen_edges, source_id, target_id, rel_type)

    # 3. Deletes -> drop nodes / edges.
    for obj in session.deleted:
        if type(obj) in _ENTITY_TYPES:
            # Explicitly clear touching edges — SQLite does not enforce ondelete CASCADE.
            session.query(Edge).filter((Edge.source_id == obj.id) | (Edge.target_id == obj.id)).delete(
                synchronize_session=False
            )
            node = session.get(Node, obj.id)
            if node is not None:
                session.delete(node)
            continue
        spec = _ASSOC_SPECS.get(type(obj))
        if spec is None:
            continue
        src_attr, tgt_attr, rel_type, _s, _t = spec
        session.query(Edge).filter(
            Edge.source_id == getattr(obj, src_attr),
            Edge.target_id == getattr(obj, tgt_attr),
            Edge.rel_type == rel_type,
        ).delete(synchronize_session=False)


def _ensure_node_and_edge(session, seen_nodes, seen_edges, parent_id, parent_type, child_id):
    """Add a ``contains`` edge parent -> child, ensuring the parent node exists."""
    if not parent_id:
        return
    _upsert_node(session, seen_nodes, parent_id, parent_type)
    _ensure_edge(session, seen_edges, parent_id, child_id, "contains")
