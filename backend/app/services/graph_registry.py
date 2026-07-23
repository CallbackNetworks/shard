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
# ``roles`` seeds each type's capability set (ADR-0040, replacing the four booleans):
# ``container``/``task`` are the traversal roles (ADR-0033 A5 — project is the
# container, task is the item); ``shareable``/``subscribable`` are the cross-cutting
# capabilities (ADR-0039 — a public share facade + an iCal feed). project and identity
# carry both, matching the historical identity/project-only behaviour. User types opt
# in by adding role strings.
BUILTIN_NODE_TYPES: list[dict] = [
    {
        "key": graph.NODE_PROJECT,
        "label": "Project",
        "icon": "folder",
        "color": "#818cf8",
        "roles": [graph.ROLE_CONTAINER, graph.ROLE_SHAREABLE, graph.ROLE_SUBSCRIBABLE],
    },
    {"key": graph.NODE_TASK, "label": "Task", "icon": "check-square", "color": "#38bdf8", "roles": [graph.ROLE_TASK]},
    {
        "key": graph.NODE_IDENTITY,
        "label": "Identity",
        "icon": "user",
        "color": "#f472b6",
        "roles": [graph.ROLE_SHAREABLE, graph.ROLE_SUBSCRIBABLE],
    },
    {
        "key": graph.NODE_GOAL,
        "label": "Goal",
        "icon": "target",
        "color": "#34d399",
        # A goal plays the container role (ADR-0041): projects/tasks it groups are its
        # ``contains`` children. Kept ``is_builtin`` so it stays out of the custom-container
        # nav (it has its own Goals view) while still traversing/aggregating like a container.
        "roles": [graph.ROLE_CONTAINER],
    },
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
