"""Built-in node/edge type vocabulary and idempotent seeding (see ADR-0033).

The type and relationship vocabularies are data-driven: the ``node_types`` and
``edge_types`` tables are the source of truth, seeded here with the built-ins.
Users may add their own rows on top. This module is the single definition of the
built-in set, shared by the Alembic migration and the fresh-DB startup seed so
the two never drift.
"""

from sqlalchemy.orm import Session

from app.models import EdgeType, NodeType
from app.services import graph

# Built-in node types. Kept in sync with the ``graph.NODE_*`` constants.
# ``is_container``/``is_task_like`` seed the traversal roles used by graph.py's
# leaf helpers (ADR-0033 A5): project is the container, task is the item.
BUILTIN_NODE_TYPES: list[dict] = [
    {"key": graph.NODE_PROJECT, "label": "Project", "icon": "folder", "color": "#818cf8", "is_container": True},
    {"key": graph.NODE_TASK, "label": "Task", "icon": "check-square", "color": "#38bdf8", "is_task_like": True},
    {"key": graph.NODE_IDENTITY, "label": "Identity", "icon": "user", "color": "#f472b6"},
    {"key": graph.NODE_GOAL, "label": "Goal", "icon": "target", "color": "#34d399"},
    {"key": graph.NODE_CYCLE, "label": "Cycle", "icon": "repeat", "color": "#fbbf24"},
    {"key": graph.NODE_LABEL, "label": "Label", "icon": "tag", "color": "#a78bfa"},
]

# Built-in edge types. ``is_containment`` marks relations traversed like ``contains``.
BUILTIN_EDGE_TYPES: list[dict] = [
    {"key": graph.REL_CONTAINS, "label": "Contains", "is_containment": True},
    {"key": graph.REL_MEMBER_OF, "label": "Member of"},
    {"key": graph.REL_ASSIGNED_TO, "label": "Assigned to"},
    {"key": graph.REL_DEPENDS_ON, "label": "Depends on"},
    {"key": graph.REL_LABELED, "label": "Labeled"},
    {"key": graph.REL_IN_CYCLE, "label": "In cycle"},
    {"key": graph.REL_PART_OF, "label": "Part of"},
]


def seed_builtin_types(db: Session) -> None:
    """Insert any missing built-in node/edge types. Idempotent; never overwrites."""
    existing_nodes = {k for (k,) in db.query(NodeType.key).all()}
    for spec in BUILTIN_NODE_TYPES:
        if spec["key"] not in existing_nodes:
            db.add(NodeType(is_builtin=True, **spec))
    existing_edges = {k for (k,) in db.query(EdgeType.key).all()}
    for spec in BUILTIN_EDGE_TYPES:
        if spec["key"] not in existing_edges:
            db.add(EdgeType(is_builtin=True, **spec))
    db.commit()
