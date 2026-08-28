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
from app.services.rules_engine import ACTION_VALUE_ENUMS

# ── Field declarations (ADR-0074) ────────────────────────────────────────────
# What a type says about its own ``data``: which keys are the user's to fill and what
# each one holds. Everything not declared here is either feature machinery (tokens,
# secrets, sync bookkeeping) or a key somebody wrote once by hand — an editor must be
# able to tell the three apart, and only ``data`` itself never could.
#
# ``kind`` is drawn from what the live data actually contains, not from a type system
# invented up front. ``enum`` carries its own ``options``: a fixed set the editor must
# render as a picker, because a value outside it is not a preference but a mistake
# (the same distinction ADR-0056 draws for rule values).

FIELD_KINDS = ("text", "longtext", "color", "emoji", "number", "url", "bool", "json", "enum", "date")

# Where a declared field lives. Most are keys in ``data``; a few are real columns on
# ``nodes`` (title, status, priority, dates). Without this the declaration described
# only half a node, so every page still had to hand-roll a name box — and a task
# editor drawn from the declaration would have offered assignee and estimate while
# leaving status and due date to some other surface (ADR-0074).
FIELD_STORES = ("data", "column")

_DESCRIPTION = {"key": "description", "label": "Description", "kind": "longtext"}


def _name(label: str = "Name") -> dict:
    """Every node's user-facing name is the ``title`` column, not a key in ``data``."""
    return {"key": "title", "label": label, "kind": "text", "store": "column"}


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

# The states a decision record moves through (ADR-0118). ``deprecated`` is in the set
# because the UI has always offered it and the old declaration did not — a filter you can
# select and an editor you cannot set it from are the declared/actual drift ADR-0074 exists
# to stop. ``superseded`` is what a ``supersedes`` edge sets on the far end, never a state
# somebody types on its own.
DECISION_STATUSES = ("proposed", "accepted", "deprecated", "superseded")

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
            _name(),
            _DESCRIPTION,
            # A project's own colour. Without one the UI borrows its first identity's,
            # and "first" is edge-creation order — a project with two identities gets
            # an arbitrary one of the two.
            {"key": "color", "label": "Colour", "kind": "color"},
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
        # Half of a task's editable surface is columns (ADR-0074): declaring only the
        # ``data`` half would have drawn a form offering assignee and estimate while
        # status and due date lived somewhere else entirely. Status and priority take
        # their values from the engine's own enums so the picker and the writer cannot
        # disagree (ADR-0056).
        "fields": [
            _name("Title"),
            {
                "key": "status",
                "label": "Status",
                "kind": "enum",
                "store": "column",
                "options": list(ACTION_VALUE_ENUMS["set_status"]),
            },
            {
                "key": "priority",
                "label": "Priority",
                "kind": "enum",
                "store": "column",
                "options": list(ACTION_VALUE_ENUMS["set_priority"]),
            },
            {"key": "start_date", "label": "Start date", "kind": "date", "store": "column"},
            {"key": "due_date", "label": "Due date", "kind": "date", "store": "column"},
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
        # ``container`` since ADR-0095: an identity is a level people actually file work
        # under, not only a name to hang ownership on. ADR-0040 gave that role to
        # ``organization`` alone and left identity as owner-only — production then stored
        # 6 identity -> project ``contains`` edges the rule would now refuse, and the
        # hierarchy on screen was one the app could no longer rebuild.
        "roles": [graph.ROLE_CONTAINER, graph.ROLE_SHAREABLE, graph.ROLE_SUBSCRIBABLE],
        # The whole reason the Identity page still exists: three fields no generic
        # surface could draw. Declared, they stop being a reason for a page.
        "fields": [
            _name(),
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
        "fields": [_name(), _DESCRIPTION],
    },
    {
        "key": graph.NODE_CYCLE,
        "label": "Cycle",
        "icon": "repeat",
        "color": "#fbbf24",
        "fields": [_name(), _DESCRIPTION],
    },
    {
        "key": graph.NODE_LABEL,
        "label": "Label",
        "icon": "tag",
        "color": "#a78bfa",
        # A label is a label again (ADR-0118). ``type``/``decision_status`` used to be
        # declared here because ADR-0004 stored a decision as a label wearing a data key;
        # a decision is its own type now, so declaring them would offer every label a
        # picker that turns it into something the decision surfaces would then not find.
        "fields": [
            _name(),
            {"key": "color", "label": "Colour", "kind": "color"},
            _DESCRIPTION,
        ],
    },
    {
        "key": graph.NODE_DECISION,
        "label": "Decision",
        "icon": "git-fork",
        "color": "#818cf8",
        # No roles: a decision is neither a place work lives nor a piece of work. It is
        # generic, so ``contains`` may file it under a project the same way a label is
        # filed — and, carrying no ``task`` role, it stays out of every size and progress
        # rollup (ADR-0068) exactly as it did while it was a label.
        #
        # ``source`` (manual/frontend/ai) stays undeclared: it records which surface wrote
        # the row, which is the system's note to itself, not a field to hand a user.
        "fields": [
            _name("Title"),
            {"key": "color", "label": "Colour", "kind": "color"},
            _DESCRIPTION,
            {
                "key": "decision_status",
                "label": "Status",
                "kind": "enum",
                "options": list(DECISION_STATUSES),
            },
        ],
    },
]

# Built-in edge types. ``is_containment`` marks relations traversed like ``contains``.
#
# Each relation declares what may sit at its ends (ADR-0078): ``allowed_source`` /
# ``allowed_target`` are ``{"types": [...], "roles": [...]}`` allow-lists — either key
# may match, and an absent key constrains nothing. Prefer ``roles``: a user-defined
# type that opts into ``container`` joins ``contains`` with no change here. The
# ``description`` is the text an agent reads (``GET /api/v1/edge-types``, and the
# ``conventions.relations`` block of ``/api/v1/agent-context`` is generated from it),
# so it says *when to reach for this relation*, not what its name means.
BUILTIN_EDGE_TYPES: list[dict] = [
    {
        "key": graph.REL_CONTAINS,
        "label": "Contains",
        "is_containment": True,
        "description": (
            "Parent -> child: where a node lives. The aggregation skeleton — progress, "
            "project size and every subtree rollup follow it. A type that declares roles "
            "must hold 'container' or 'task' to be the source; a type declaring no roles "
            "is generic and may nest freely. Identity holds 'container' (ADR-0095), so a "
            "persona may be a level work is filed under — reach for 'owns' when you mean "
            "whose something is rather than where it lives, because only 'contains' "
            "carries the rollups."
        ),
    },
    {
        "key": graph.REL_OWNS,
        "label": "Owns",
        "description": (
            "Identity -> the container it owns: whose work this is, not where it lives. "
            "A container may be owned by several identities and still live in exactly "
            "one place, which is why this is not 'contains'."
        ),
        "allowed_source": {"types": [graph.NODE_IDENTITY]},
        "allowed_target": {"roles": [graph.ROLE_CONTAINER]},
    },
    {
        "key": graph.REL_DEPENDS_ON,
        "label": "Depends on",
        "description": "Blocked task -> the task blocking it. Source is blocked until target is done.",
        "allowed_source": {"roles": [graph.ROLE_TASK]},
        "allowed_target": {"roles": [graph.ROLE_TASK]},
    },
    {
        "key": graph.REL_LABELED,
        "label": "Labeled",
        "description": "Node -> label. Reach for 'governs' to attach a decision record to work instead.",
        "allowed_target": {"types": [graph.NODE_LABEL]},
    },
    {
        "key": graph.REL_IN_CYCLE,
        "label": "In cycle",
        "description": "Task -> the cycle/sprint it belongs to.",
        "allowed_source": {"roles": [graph.ROLE_TASK]},
        "allowed_target": {"types": [graph.NODE_CYCLE]},
    },
    {
        "key": graph.REL_SUPERSEDES,
        "label": "Supersedes",
        "description": (
            "Newer decision -> the decision it replaces. The spine a decision record's "
            "history hangs on: the 'superseded' status says a decision was replaced and "
            "nothing else says by what, so record the relation and the status on the far "
            "end follows from it."
        ),
        "allowed_source": {"types": [graph.NODE_DECISION]},
        "allowed_target": {"types": [graph.NODE_DECISION]},
    },
    {
        "key": graph.REL_GOVERNS,
        "label": "Governs",
        "description": (
            "Decision -> the work it decides: a task, a project or any other container. "
            "This is what makes a decision answerable about its own reach — without it a "
            "record states a conclusion and names nothing it applies to."
        ),
        "allowed_source": {"types": [graph.NODE_DECISION]},
        "allowed_target": {"roles": [graph.ROLE_TASK, graph.ROLE_CONTAINER]},
    },
]


# ── Node-type registry operations (ADR-0079) ─────────────────────────────────
# Held here rather than in a router because there are now two doors onto the
# registry — the SPA's ``/api/graph-types/nodes`` and the external
# ``/api/v1/node-types`` — and a guard that exists on one is worth nothing if the
# other can be used to step around it. Routers translate ``TypeRegistryError``
# into HTTP; the rules live once.

# Roles whose membership is frozen on built-in types: flipping project's ``container``
# or task's ``task`` role would collapse the compat/enrichment pipeline (ADR-0034/0035).
IMMUTABLE_BUILTIN_ROLES = {graph.ROLE_CONTAINER, graph.ROLE_TASK}

# What a built-in type *declares* is code, and code is the only place it can change
# (ADR-0121). These are not documentation: ``allowed_source``/``allowed_target`` are
# enforced by ``graph.add_edge`` on every write, and ``fields`` decides what the generic
# editor draws and writes. Editing them here changed real behaviour and then had it
# reverted, without warning, by the next revision that resynced the declarations
# (ADR-0119) — a revision shipped for an unrelated reason, weeks later, with no
# connection to the edit. A rule the code enforces cannot also be a row the API rewrites.
#
# Everything else stays editable: label, icon, colour, and any role outside
# ``IMMUTABLE_BUILTIN_ROLES``. Those are yours, nothing resyncs them, and the UI has
# buttons for them.
FROZEN_BUILTIN_NODE_DECLARATIONS = ("fields",)
FROZEN_BUILTIN_EDGE_DECLARATIONS = ("description", "allowed_source", "allowed_target")


def _refuse_builtin_declaration_change(kind: str, frozen: tuple[str, ...], patch: dict) -> None:
    named = sorted(f for f in frozen if f in patch)
    if not named:
        return
    raise TypeRegistryError(
        400,
        f"cannot change {', '.join(named)} on a built-in {kind} type: it is declared in code "
        "and would be reverted by the next declaration resync",
    )


class TypeRegistryError(Exception):
    """A refusal that both registry doors must report identically."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def node_types_with_usage(db: Session) -> list[NodeType]:
    """Every node type, built-ins first, each carrying how many nodes use it."""
    from sqlalchemy import func

    from app.models import Node

    types = db.query(NodeType).order_by(NodeType.is_builtin.desc(), NodeType.key).all()
    counts = dict(db.query(Node.type, func.count(Node.id)).group_by(Node.type).all())
    for nt in types:
        nt.usage_count = counts.get(nt.key, 0)
    return types


def create_node_type(db: Session, body) -> NodeType:
    """Register a new layer. ``body`` is a ``NodeTypeCreate`` (its own validators
    already reject a managed data key, an unknown ``kind`` and an unknown ``store``)."""
    if db.get(NodeType, body.key) is not None:
        raise TypeRegistryError(409, f"node type '{body.key}' already exists")
    nt = NodeType(
        is_builtin=False,
        key=body.key,
        label=body.label,
        icon=body.icon,
        color=body.color,
        data=body.data,
        roles=sorted(set(body.roles)) if body.roles else None,
        # A type may declare which keys of its nodes' ``data`` are the user's (ADR-0074).
        fields=[f.model_dump(exclude_none=True) for f in body.fields] if body.fields else None,
    )
    db.add(nt)
    db.commit()
    db.refresh(nt)
    return nt


def update_node_type(db: Session, key: str, body) -> NodeType:
    nt = db.get(NodeType, key)
    if nt is None:
        raise TypeRegistryError(404, "node type not found")
    # Named ``patch``, not ``fields``: ``fields`` is now a column of its own (ADR-0074).
    patch = body.model_dump(exclude_unset=True, exclude_none=False)
    if nt.is_builtin:
        _refuse_builtin_declaration_change("node", FROZEN_BUILTIN_NODE_DECLARATIONS, patch)
    if "roles" in patch:
        new_roles = set(patch.pop("roles") or [])
        if nt.is_builtin and (
            {r for r in new_roles if r in IMMUTABLE_BUILTIN_ROLES}
            != {r for r in (nt.roles or []) if r in IMMUTABLE_BUILTIN_ROLES}
        ):
            raise TypeRegistryError(400, "cannot change roles of a built-in node type")
        nt.roles = sorted(new_roles) or None
    if "fields" in patch:
        declared = patch.pop("fields")
        nt.fields = [{k: v for k, v in f.items() if v is not None} for f in declared] if declared else None
    for field, value in patch.items():
        setattr(nt, field, value)
    db.commit()
    db.refresh(nt)
    return nt


def delete_node_type(db: Session, key: str) -> None:
    from app.models import Node

    nt = db.get(NodeType, key)
    if nt is None:
        raise TypeRegistryError(404, "node type not found")
    if nt.is_builtin:
        raise TypeRegistryError(400, "cannot delete a built-in node type")
    if db.query(Node.id).filter(Node.type == key).first() is not None:
        raise TypeRegistryError(409, "node type is still in use by existing nodes")
    db.delete(nt)
    db.commit()


def type_vocabulary(db: Session) -> list[dict]:
    """The node-type vocabulary as an agent needs it (ADR-0079).

    ``type`` is a required field of every node write, and until this existed nothing
    under ``/api/v1`` said which values were legal — the caller had to already know.
    Roles travel with it because they are what decides where a node of that type may
    sit (ADR-0078): a ``container`` may parent, a ``task`` may be a subtask.
    """
    return [
        {
            "key": nt.key,
            "label": nt.label,
            "roles": nt.roles or [],
            "is_builtin": nt.is_builtin,
            "fields": nt.fields or [],
        }
        for nt in db.query(NodeType).order_by(NodeType.is_builtin.desc(), NodeType.key).all()
    ]


def relation_vocabulary(db: Session) -> list[dict]:
    """The relation vocabulary as an agent needs to read it (ADR-0078).

    One renderer behind ``GET /api/v1/edge-types`` and the ``conventions.relations``
    block of ``/api/v1/agent-context``: what an agent is told about a relation is
    generated from the registry the write path enforces, never written out a second
    time by hand — a hand-copied vocabulary is how the rules editor came to offer
    values the engine rejected (ADR-0056).
    """
    return [
        {
            "key": et.key,
            "label": et.label,
            "description": et.description,
            "is_containment": et.is_containment,
            "allowed_source": et.allowed_source,
            "allowed_target": et.allowed_target,
        }
        for et in db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()
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


# --- Edge types (ADR-0086) ---------------------------------------------------
#
# ADR-0079 gave node types a v1 door and deliberately left edge types read-only there,
# reasoning that a relation created without endpoint declarations is what ADR-0078 closed.
# That reason no longer holds up: the internal `/api/graph-types/edges` has always been
# able to create one with `allowed_source`/`allowed_target` left NULL, so the restriction
# never prevented an unconstrained relation — it only prevented an agent from reaching a
# state the UI could reach in two clicks. What ADR-0078 actually buys is that a *declared*
# endpoint rule is enforced, and that holds wherever the type came from.
#
# So the guards move here, next to the node-type ones, for the same reason those did: a
# guard enforced at one door is not a guard.


def edge_types_with_usage(db: Session) -> list[EdgeType]:
    """Every edge type, built-ins first, each carrying how many edges use it."""
    from sqlalchemy import func

    from app.models import Edge

    types = db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()
    counts = dict(db.query(Edge.rel_type, func.count(Edge.id)).group_by(Edge.rel_type).all())
    for et in types:
        et.usage_count = counts.get(et.key, 0)
    return types


def check_endpoint_rules(db: Session, body) -> None:
    """Reject an endpoint declaration naming a role or node type that does not exist.

    A rule carrying a typo constrains nothing and says nothing about why — the same
    silent-empty-set trap ADR-0056 closed for condition values, applied to ADR-0078's
    endpoint declarations.
    """
    known_types = {key for (key,) in db.query(NodeType.key).all()}
    for side in ("allowed_source", "allowed_target"):
        rule = getattr(body, side, None)
        if rule is None:
            continue
        unknown_roles = [r for r in rule.roles if r not in graph.ROLES]
        if unknown_roles:
            raise TypeRegistryError(422, f"{side}: unknown role(s) {', '.join(unknown_roles)}")
        unknown_types = [t for t in rule.types if t not in known_types]
        if unknown_types:
            raise TypeRegistryError(422, f"{side}: unknown node type(s) {', '.join(unknown_types)}")


def create_edge_type(db: Session, body) -> EdgeType:
    if db.get(EdgeType, body.key) is not None:
        raise TypeRegistryError(409, f"edge type '{body.key}' already exists")
    check_endpoint_rules(db, body)
    et = EdgeType(is_builtin=False, **body.model_dump())
    db.add(et)
    db.commit()
    db.refresh(et)
    return et


def update_edge_type(db: Session, key: str, body) -> EdgeType:
    et = db.get(EdgeType, key)
    if et is None:
        raise TypeRegistryError(404, "edge type not found")
    check_endpoint_rules(db, body)
    fields = body.model_dump(exclude_unset=True)
    # Built-in structural flags are immutable — mirroring the node-type role guard:
    # flipping contains' is_containment would collapse the containment pipeline
    # (project/task membership, structure map, unfiled detection).
    if et.is_builtin and ("is_containment" in fields or "is_symmetric" in fields):
        raise TypeRegistryError(400, "cannot change structural flags of a built-in edge type")
    if et.is_builtin:
        _refuse_builtin_declaration_change("edge", FROZEN_BUILTIN_EDGE_DECLARATIONS, fields)
    for field, value in fields.items():
        setattr(et, field, value)
    db.commit()
    db.refresh(et)
    return et


def delete_edge_type(db: Session, key: str) -> None:
    from app.models import Edge

    et = db.get(EdgeType, key)
    if et is None:
        raise TypeRegistryError(404, "edge type not found")
    if et.is_builtin:
        raise TypeRegistryError(400, "cannot delete a built-in edge type")
    if db.query(Edge.id).filter(Edge.rel_type == key).first() is not None:
        raise TypeRegistryError(409, "edge type is still in use by existing edges")
    db.delete(et)
    db.commit()
