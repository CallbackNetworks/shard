"""Graph core: node/edge CRUD, traversal, provenance (see ADR-0032/0033).

Single place that owns node/edge CRUD and traversal. Callers should go through
these helpers rather than querying ``Node`` / ``Edge`` directly so that cycle
prevention and the "nearest ancestor" rules stay consistent.
"""

import secrets
import uuid
from collections import defaultdict, deque
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Edge, GraphEvent, Node, NodeType

# Node types. Every first-class entity is node-only (ADR-0033 Phase B complete):
# these are the built-in ``node_types`` seed keys, not backing-table markers.
NODE_PROJECT = "project"
NODE_TASK = "task"
NODE_IDENTITY = "identity"
NODE_GOAL = "goal"
NODE_CYCLE = "cycle"
NODE_LABEL = "label"

# Edge relationship types (canonical direction: source -> target)
REL_CONTAINS = "contains"  # parent (project/task) -> child task; replaces project_id + parent_id
REL_MEMBER_OF = "member_of"  # identity -> project
REL_ASSIGNED_TO = "assigned_to"  # task -> identity
REL_DEPENDS_ON = "depends_on"  # blocked task -> prerequisite task
REL_LABELED = "labeled"  # task -> label
REL_IN_CYCLE = "in_cycle"  # task -> cycle

# Widest ``IN (...)`` batch a level-at-a-time traversal will build. Well under every
# supported driver's bind-parameter ceiling (SQLite's historical 999 included).
_IN_CHUNK = 500


# A container's status has one rule (ADR-0075). The ``status`` column is optional — the
# generic node write surface (``POST /api/v1/nodes``) has no reason to invent one — so a
# container row can carry NULL, and every view reads that as "active". A filter comparing
# the column directly does not, which is how ``/api/v1/projects`` could list a project
# that ``/api/v1/agent-context`` reported did not exist. Read the default and filter for
# it through this pair, never by hand.
CONTAINER_DEFAULT_STATUS = "active"


def container_status(node: Node) -> str:
    """The status a container presents: its column, or the default when unset."""
    return node.status or CONTAINER_DEFAULT_STATUS


def container_status_filter(status: str):
    """Criterion matching ``status`` the way :func:`container_status` reads it."""
    if status == CONTAINER_DEFAULT_STATUS:
        return or_(Node.status == status, Node.status.is_(None))
    return Node.status == status


# --- Capability roles (registry-driven; ADR-0033 A5, ADR-0040) ---------------

# Role vocabulary carried by ``node_types.roles`` (ADR-0040). Nouns, no ``-like``.
ROLE_CONTAINER = "container"  # plays the project/container role
ROLE_TASK = "task"  # plays the task/subtask role
ROLE_SHAREABLE = "shareable"  # can mint a public share facade
ROLE_SUBSCRIBABLE = "subscribable"  # can expose an iCal feed

# The whole role vocabulary, in the order it is offered to a user. Closed: a role is a
# capability the code implements, not user-defined data like a node type, so a name
# outside this tuple is a typo — and a ``has_role`` condition carrying one matches
# nothing and says nothing about why (ADR-0056).
ROLES = (ROLE_CONTAINER, ROLE_TASK, ROLE_SHAREABLE, ROLE_SUBSCRIBABLE)


def has_role(db: Session, type_key: str, role: str) -> bool:
    """Whether the node type ``type_key`` carries ``role`` (ADR-0040).

    The single read helper replacing the scattered ``is_*`` boolean reads; the
    ``*_type_keys`` sets below are its batch form for query filtering.
    """
    nt = db.get(NodeType, type_key)
    return nt is not None and role in (nt.roles or [])


def _type_keys_with_role(db: Session, role: str) -> set[str]:
    """Keys of every node type carrying ``role`` (ADR-0040).

    Filters in Python over the (tiny) node-type registry so the ``roles`` JSON set
    needs no dialect-specific array/containment operator.
    """
    return {nt.key for nt in db.query(NodeType).all() if role in (nt.roles or [])}


def container_type_keys(db: Session) -> set[str]:
    """Node-type keys that play the container role (seeded: ``project``).

    A task's "projects" are its container-role ``contains`` parents.
    """
    return _type_keys_with_role(db, ROLE_CONTAINER)


def task_type_keys(db: Session) -> set[str]:
    """Node-type keys that play the task/item role (seeded: ``task``)."""
    return _type_keys_with_role(db, ROLE_TASK)


def shareable_type_keys(db: Session) -> set[str]:
    """Node-type keys that may mint a public share facade (seeded: identity, project).

    Callers gate share endpoints by capability instead of hardcoding identity/project.
    """
    return _type_keys_with_role(db, ROLE_SHAREABLE)


def subscribable_type_keys(db: Session) -> set[str]:
    """Node-type keys that may expose an iCal feed (seeded: identity, project)."""
    return _type_keys_with_role(db, ROLE_SUBSCRIBABLE)


def node_is_shareable(db: Session, node: Node) -> bool:
    """Whether ``node``'s type carries the shareable capability (ADR-0039)."""
    return node.type in shareable_type_keys(db)


def node_is_subscribable(db: Session, node: Node) -> bool:
    """Whether ``node``'s type carries the subscribable (iCal) capability (ADR-0039)."""
    return node.type in subscribable_type_keys(db)


def _find_node_by_token(db: Session, token: str, type_keys: set[str]) -> Node | None:
    """Scan nodes of ``type_keys`` for a ``data.share_token`` match.

    Python-side scan because the token lives in the JSON ``data`` bag (no indexed
    column); node counts are small at personal-tool scale.
    """
    if not token or not type_keys:
        return None
    for node in db.query(Node).filter(Node.type.in_(type_keys)).all():
        if (node.data or {}).get("share_token") == token:
            return node
    return None


def find_node_by_share_token(db: Session, token: str) -> Node | None:
    """Locate any shareable node by its ``share_token`` (ADR-0039).

    Generalizes ``find_identity_by_share_token``/``find_project_by_share_token``
    across every ``is_shareable`` type. Returns the raw ``Node`` so the caller
    can serialize per type.
    """
    return _find_node_by_token(db, token, shareable_type_keys(db))


def find_subscribable_node_by_share_token(db: Session, token: str) -> Node | None:
    """Locate any ``is_subscribable`` node by its ``share_token`` (ADR-0039)."""
    return _find_node_by_token(db, token, subscribable_type_keys(db))


# --- Shared JSON datetime helpers --------------------------------------------


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else value


def _parse_dt(value):
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


# --- Task data surface (shared with user-defined task-like types, ADR-0035) ---

_TASK_DATA_SCALARS = (
    "description",
    "callback_token",
    "webhook_secret",
    "assignee",
    "assigned_agent_key_id",
    "time_estimate",
    "time_spent",
    "progress_pct",
    "agent_notes",
    "external_provider",
    "external_id",
    "external_url",
    "external_repo",
)


def _apply_task_data_defaults(data: dict) -> dict:
    """Seed a task node's ``data`` with the full scalar surface + webhook credentials.

    Shared by ``create_task`` (built-in tasks) and ``create_node`` (user-defined
    task-like types, ADR-0035) so both produce nodes that satisfy ``TaskOut``.

    Both credentials are seeded, not just the token: the callback endpoint is
    unauthenticated by design, so the signature is the only thing standing between a
    leaked URL and a write. A secret that has to be switched on is a secret nobody
    switches on, and the callback refuses unsigned requests now (ADR-0060), so a task
    without one could not receive callbacks at all.
    """
    for key in _TASK_DATA_SCALARS:
        data.setdefault(key, None)
    if not data.get("callback_token"):
        data["callback_token"] = str(uuid.uuid4())
    if not data.get("webhook_secret"):
        data["webhook_secret"] = new_webhook_secret()
    return data


def new_webhook_secret() -> str:
    """A signing key for inbound CI callbacks.

    Hex rather than URL-safe base64: it is pasted into CI provider settings by hand and
    ends up in shell one-liners, so it should survive being quoted, logged and copied.
    """
    return secrets.token_hex(32)


# --- Provenance (audit trail) ------------------------------------------------


def _log_event(
    db: Session,
    event: str,
    *,
    node_id: str | None = None,
    source_id: str | None = None,
    target_id: str | None = None,
    rel_type: str | None = None,
    actor: str | None = None,
    data: dict | None = None,
) -> None:
    """Append a provenance event (ADR-0033). Append-only; never updated."""
    db.add(
        GraphEvent(
            event=event,
            node_id=node_id,
            source_id=source_id,
            target_id=target_id,
            rel_type=rel_type,
            actor=actor,
            data=data,
        )
    )


# --- Node CRUD ---------------------------------------------------------------


def create_node(
    db: Session, node_type: str, *, id: str | None = None, title: str = "", actor: str | None = None, **fields
) -> Node:
    """Create a node. Unknown keyword fields are folded into ``data``."""
    columns = {"status", "priority", "start_date", "due_date", "position", "is_pinned"}
    col_values = {k: fields.pop(k) for k in list(fields) if k in columns}
    node = Node(type=node_type, title=title, data=fields or None, **col_values)
    if id is not None:
        node.id = id
    # A user-defined task-like type is a first-class task (ADR-0035): give its nodes
    # the full task ``data`` surface (callback_token + scalar slots) so they load as
    # TaskViews and enrich exactly like built-in tasks.
    if node_type in task_type_keys(db):
        node.data = _apply_task_data_defaults(dict(node.data or {}))
    # Any shareable-role type gets a share_token seeded at creation (ADR-0041 B), so a
    # node written through the generic surface is immediately shareable — no per-type
    # create code. An explicit token in ``fields`` wins (setdefault).
    if node_type in shareable_type_keys(db):
        data = dict(node.data or {})
        data.setdefault("share_token", str(uuid.uuid4()))
        node.data = data
    db.add(node)
    db.flush()
    _log_event(db, "node_created", node_id=node.id, actor=actor, data={"type": node_type})
    return node


def get_node(db: Session, node_id: str) -> Node | None:
    return db.get(Node, node_id)


def ensure_node(db: Session, node_id: str, node_type: str, *, title: str = "") -> Node:
    """Return the node with this id, creating a minimal one if it does not exist.

    Used when linking entities whose node was not yet mirrored into the graph
    (e.g. rows created after the initial backfill, before the write path is cut
    over in a later phase).
    """
    node = db.get(Node, node_id)
    if node is None:
        node = create_node(db, node_type, id=node_id, title=title)
    return node


# The node fields that are real columns rather than keys in ``data``. Named once so a
# type's field declaration can say "this one is a column" and be checked against the
# same list the write below routes by (ADR-0074) — otherwise a declared column the
# writer does not recognise would land silently in ``data`` under the same name.
WRITABLE_COLUMNS = frozenset({"title", "status", "priority", "start_date", "due_date", "position", "is_pinned"})


def update_node(db: Session, node_id: str, **fields) -> Node | None:
    node = db.get(Node, node_id)
    if node is None:
        return None
    columns = WRITABLE_COLUMNS
    data = dict(node.data or {})
    for key, value in fields.items():
        if key in columns:
            setattr(node, key, value)
        else:
            data[key] = value
    node.data = data or None
    db.flush()
    return node


def delete_node(db: Session, node_id: str, *, actor: str | None = None) -> bool:
    """Delete a node and every edge touching it."""
    node = db.get(Node, node_id)
    if node is None:
        return False
    node_type = node.type
    db.query(Edge).filter((Edge.source_id == node_id) | (Edge.target_id == node_id)).delete(synchronize_session=False)
    db.delete(node)
    db.flush()
    _log_event(db, "node_deleted", node_id=node_id, actor=actor, data={"type": node_type})
    return True


# --- Edge CRUD ---------------------------------------------------------------


def add_edge(
    db: Session,
    source_id: str,
    target_id: str,
    rel_type: str,
    *,
    position: int = 0,
    data: dict | None = None,
    actor: str | None = None,
) -> Edge:
    """Create an edge if it does not already exist; otherwise return the existing one.

    For ``contains`` edges this guards against introducing a cycle.
    """
    if rel_type == REL_CONTAINS and detect_cycle(db, source_id, target_id):
        raise ValueError(f"adding contains edge {source_id} -> {target_id} would create a cycle")
    existing = db.execute(
        select(Edge).where(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    edge = Edge(source_id=source_id, target_id=target_id, rel_type=rel_type, position=position, data=data)
    db.add(edge)
    db.flush()
    _log_event(db, "edge_added", source_id=source_id, target_id=target_id, rel_type=rel_type, actor=actor)
    return edge


def remove_edges(db: Session, *, source_id: str | None = None, target_id: str | None = None, rel_type: str) -> int:
    """Delete every edge of ``rel_type`` matching the given endpoint(s).

    Used to clear all relationships of a kind for an endpoint in one shot (e.g.
    replacing a goal's linked projects).
    """
    q = db.query(Edge).filter(Edge.rel_type == rel_type)
    if source_id is not None:
        q = q.filter(Edge.source_id == source_id)
    if target_id is not None:
        q = q.filter(Edge.target_id == target_id)
    deleted = q.delete(synchronize_session=False)
    db.flush()
    return deleted


def remove_edge(db: Session, source_id: str, target_id: str, rel_type: str, *, actor: str | None = None) -> bool:
    deleted = (
        db.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .delete(synchronize_session=False)
    )
    db.flush()
    if deleted:
        _log_event(db, "edge_removed", source_id=source_id, target_id=target_id, rel_type=rel_type, actor=actor)
    return bool(deleted)


# --- Traversal ---------------------------------------------------------------


def neighbors(db: Session, node_id: str, rel_type: str, *, direction: str = "out") -> list[Node]:
    """Return nodes connected to ``node_id`` by ``rel_type``.

    direction "out": nodes this node points at (targets).
    direction "in": nodes pointing at this node (sources).

    Deterministic order: edge ``position``, then ``created_at`` (oldest first).
    """
    if direction == "out":
        stmt = (
            select(Node)
            .join(Edge, Edge.target_id == Node.id)
            .where(Edge.source_id == node_id, Edge.rel_type == rel_type)
            .order_by(Edge.position, Edge.created_at)
        )
    else:
        stmt = (
            select(Node)
            .join(Edge, Edge.source_id == Node.id)
            .where(Edge.target_id == node_id, Edge.rel_type == rel_type)
            .order_by(Edge.position, Edge.created_at)
        )
    return list(db.execute(stmt).scalars().all())


def children_of(db: Session, node_id: str) -> list[Node]:
    """Direct children via ``contains`` (task's subtasks / project's tasks)."""
    return neighbors(db, node_id, REL_CONTAINS, direction="out")


def parents_of(db: Session, node_id: str) -> list[Node]:
    """Direct parents via ``contains``. May be more than one (multi-membership)."""
    return neighbors(db, node_id, REL_CONTAINS, direction="in")


def ancestors_of(db: Session, node_id: str) -> list[Node]:
    """All transitive parents via ``contains``, breadth-first, de-duplicated."""
    seen: set[str] = set()
    ordered: list[Node] = []
    queue: deque[str] = deque([node_id])
    while queue:
        current = queue.popleft()
        for parent in parents_of(db, current):
            if parent.id not in seen:
                seen.add(parent.id)
                ordered.append(parent)
                queue.append(parent.id)
    return ordered


def nearest_ancestor_of_type(db: Session, node_id: str, node_type: str) -> Node | None:
    """Nearest ``contains`` ancestor of the given type (e.g. a task's home project).

    Breadth-first from the node; within a level the deterministic tie-break is
    edge ``position`` then ``created_at`` (already applied by ``parents_of``).
    """
    queue: deque[str] = deque([node_id])
    seen: set[str] = {node_id}
    while queue:
        current = queue.popleft()
        for parent in parents_of(db, current):
            if parent.type == node_type:
                return parent
            if parent.id not in seen:
                seen.add(parent.id)
                queue.append(parent.id)
    return None


def descendants_of(db: Session, node_id: str) -> set[str]:
    """Ids of all transitive children via ``contains``.

    Walks one *level* per query rather than one node per query: a container with
    200 tasks used to cost 200 round trips, which made subtree rollups (ADR-0065)
    too expensive to put on a list endpoint. ``IN`` batches stay chunked so a wide
    level cannot hit a driver's bind-parameter limit.
    """
    seen: set[str] = set()
    frontier: list[str] = [node_id]
    while frontier:
        children: list[str] = []
        for start in range(0, len(frontier), _IN_CHUNK):
            rows = db.execute(
                select(Edge.target_id).where(
                    Edge.rel_type == REL_CONTAINS,
                    Edge.source_id.in_(frontier[start : start + _IN_CHUNK]),
                )
            ).scalars()
            children.extend(rows)
        frontier = [child_id for child_id in dict.fromkeys(children) if child_id not in seen]
        seen.update(frontier)
    return seen


def detect_cycle(db: Session, source_id: str, target_id: str) -> bool:
    """Would adding ``contains`` edge source -> target create a cycle?

    True if source == target, or if source is already a descendant of target
    (which would close a loop once target also contains source).
    """
    if source_id == target_id:
        return True
    return source_id in descendants_of(db, target_id)


def prerequisite_ids(db: Session, task_id: str) -> list[str]:
    """Tasks that block ``task_id`` (blocked_by) — targets of its depends_on edges."""
    rows = db.execute(
        select(Edge.target_id).where(Edge.source_id == task_id, Edge.rel_type == REL_DEPENDS_ON)
    ).scalars()
    return list(rows)


def dependent_ids(db: Session, task_id: str) -> list[str]:
    """Tasks that ``task_id`` blocks (blocking) — sources of depends_on edges pointing at it."""
    rows = db.execute(
        select(Edge.source_id).where(Edge.target_id == task_id, Edge.rel_type == REL_DEPENDS_ON)
    ).scalars()
    return list(rows)


def dependency_maps(db: Session, task_ids) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Batch-load dependency edges for many tasks in one query (avoids N+1).

    Returns ``(blocked_by, blocking)`` where ``blocked_by[t]`` are the tasks that
    must complete before ``t``, and ``blocking[t]`` are the tasks waiting on ``t``.
    """
    ids = set(task_ids)
    blocked_by: dict[str, list[str]] = defaultdict(list)
    blocking: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return blocked_by, blocking
    edges = db.execute(
        select(Edge.source_id, Edge.target_id).where(
            Edge.rel_type == REL_DEPENDS_ON,
            or_(Edge.source_id.in_(ids), Edge.target_id.in_(ids)),
        )
    ).all()
    for source_id, target_id in edges:
        if source_id in ids:
            blocked_by[source_id].append(target_id)
        if target_id in ids:
            blocking[target_id].append(source_id)
    return blocked_by, blocking


def project_container_map(db: Session, node_ids) -> dict[str, str]:
    """Batch-resolve each node's containing project id via ``contains`` edges.

    Shared by the node-only project-scoped entities (label, cycle, ...) whose
    project membership is a ``contains`` edge from a container-role node.
    """
    ids = set(node_ids)
    result: dict[str, str] = {}
    if not ids:
        return result
    container_keys = container_type_keys(db)
    rows = db.execute(
        select(Edge.target_id, Edge.source_id)
        .join(Node, Node.id == Edge.source_id)
        .where(Edge.rel_type == REL_CONTAINS, Edge.target_id.in_(ids), Node.type.in_(container_keys))
    ).all()
    for target_id, source_id in rows:
        result.setdefault(target_id, source_id)
    return result
