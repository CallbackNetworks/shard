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

# ── Field declarations (ADR-0074) ────────────────────────────────────────────
# What a type says about its own ``data``: which keys are the user's to fill and what
# each one holds. Everything not declared here is either feature machinery (tokens,
# secrets, sync bookkeeping) or a key somebody wrote once by hand — an editor must be
# able to tell the three apart, and only ``data`` itself never could.
#
# ``kind`` is drawn from what the live data actually contains, not from a type system
# invented up front: text / longtext / color / emoji / number / url / bool / json.

FIELD_KINDS = ("text", "longtext", "color", "emoji", "number", "url", "bool", "json")

_DESCRIPTION = {"key": "description", "label": "Description", "kind": "longtext"}

# Keys no editor may write, whatever a type declares. A share token *is* the public URL
# and a callback token *is* the authority to post a build result (ADR-0059, ADR-0060);
# the rest are written by a feature and read by it. Kept here beside the declarations so
# the two lists are read together and cannot drift into overlapping.
MANAGED_DATA_KEYS = (
    "share_token",
    "share_pin_hash",
    "share_expires_at",
    "allow_guest_notes",
    "callback_token",
    "webhook_secret",
    "assigned_agent_key_id",
    "reminder_sent_at",
    "external_provider",
    "external_id",
    "external_url",
    "external_repo",
)

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
        "fields": [
            _DESCRIPTION,
            {"key": "repo_url", "label": "Repository URL", "kind": "url"},
            {"key": "agent_instructions", "label": "Agent instructions", "kind": "longtext"},
            {"key": "wip_limits", "label": "WIP limits", "kind": "json"},
        ],
    },
    {
        "key": graph.NODE_TASK,
        "label": "Task",
        "icon": "check-square",
        "color": "#38bdf8",
        "roles": [graph.ROLE_TASK],
        "fields": [
            _DESCRIPTION,
            {"key": "assignee", "label": "Assignee", "kind": "text"},
            {"key": "time_estimate", "label": "Estimate (min)", "kind": "number"},
            {"key": "time_spent", "label": "Spent (min)", "kind": "number"},
            {"key": "progress_pct", "label": "Progress (%)", "kind": "number"},
            {"key": "agent_notes", "label": "Agent notes", "kind": "longtext"},
        ],
    },
    {
        "key": graph.NODE_IDENTITY,
        "label": "Identity",
        "icon": "user",
        "color": "#f472b6",
        "roles": [graph.ROLE_SHAREABLE, graph.ROLE_SUBSCRIBABLE],
        # The whole reason the Identity page still exists: three fields no generic
        # surface could draw. Declared, they stop being a reason for a page.
        "fields": [
            {"key": "color", "label": "Colour", "kind": "color"},
            {"key": "avatar", "label": "Avatar", "kind": "emoji", "max_length": 2},
            _DESCRIPTION,
        ],
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
        "fields": [_DESCRIPTION],
    },
    {
        "key": graph.NODE_CYCLE,
        "label": "Cycle",
        "icon": "repeat",
        "color": "#fbbf24",
        "fields": [_DESCRIPTION],
    },
    {
        "key": graph.NODE_LABEL,
        "label": "Label",
        "icon": "tag",
        "color": "#a78bfa",
        # ``type``/``decision_status``/``source`` carry the decisions-as-labels
        # convention (ADR-0004); they are the user's to set, so they are declared.
        "fields": [
            {"key": "color", "label": "Colour", "kind": "color"},
            _DESCRIPTION,
            {"key": "type", "label": "Kind", "kind": "text"},
            {"key": "decision_status", "label": "Decision status", "kind": "text"},
            {"key": "source", "label": "Source", "kind": "text"},
        ],
    },
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
