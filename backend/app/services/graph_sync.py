"""Keep the graph mirror in sync with association-table mutations (ADR-0032).

A single ``before_flush`` listener translates inserts/deletes of the five
association objects into the corresponding ``edges`` rows, so every write site
in the codebase stays mirrored without being individually patched. Entity nodes
are lazily created if not yet present.

Direction of each edge matches the backfill migration (source -> target).

Known limitation: bulk ORM operations (``query(...).delete()`` /
``update()``) bypass the ORM unit-of-work and therefore this listener. Those
sites must sync explicitly until the read path treats edges as authoritative.
"""

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models import CycleTask, Edge, GoalProject, Node, ProjectIdentity, TaskDependency, TaskLabel

# association type -> (source_attr, target_attr, rel_type, source_node_type, target_node_type)
_ASSOC_SPECS = {
    TaskLabel: ("task_id", "label_id", "labeled", "task", "label"),
    TaskDependency: ("task_id", "depends_on_id", "depends_on", "task", "task"),
    CycleTask: ("task_id", "cycle_id", "in_cycle", "task", "cycle"),
    ProjectIdentity: ("identity_id", "project_id", "member_of", "identity", "project"),
    GoalProject: ("project_id", "goal_id", "part_of", "project", "goal"),
}


def _ensure_node(session, seen_nodes, node_id, node_type):
    if not node_id or node_id in seen_nodes:
        return
    if session.get(Node, node_id) is None:
        session.add(Node(id=node_id, type=node_type, title=""))
    seen_nodes.add(node_id)


@event.listens_for(Session, "before_flush")
def _mirror_associations(session, flush_context, instances):
    seen_nodes: set[str] = set()
    seen_edges: set[tuple] = set()

    for obj in session.new:
        spec = _ASSOC_SPECS.get(type(obj))
        if spec is None:
            continue
        src_attr, tgt_attr, rel_type, src_type, tgt_type = spec
        source_id = getattr(obj, src_attr)
        target_id = getattr(obj, tgt_attr)
        if not source_id or not target_id:
            continue
        _ensure_node(session, seen_nodes, source_id, src_type)
        _ensure_node(session, seen_nodes, target_id, tgt_type)
        key = (source_id, target_id, rel_type)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        existing = (
            session.query(Edge)
            .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
            .first()
        )
        if existing is None:
            session.add(Edge(source_id=source_id, target_id=target_id, rel_type=rel_type))

    for obj in session.deleted:
        spec = _ASSOC_SPECS.get(type(obj))
        if spec is None:
            continue
        src_attr, tgt_attr, rel_type, _src_type, _tgt_type = spec
        source_id = getattr(obj, src_attr)
        target_id = getattr(obj, tgt_attr)
        session.query(Edge).filter(
            Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type
        ).delete(synchronize_session=False)
