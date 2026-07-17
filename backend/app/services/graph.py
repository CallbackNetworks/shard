"""Graph layer for the unified node/edge model (see ADR-0032).

Single place that owns node/edge CRUD and traversal. Callers should go through
these helpers rather than querying ``Node`` / ``Edge`` directly so that cycle
prevention and the "nearest ancestor" rules stay consistent.
"""

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Edge, GraphEvent, Identity, Node, NodeType, Project, Task

# Node types
NODE_PROJECT = "project"
NODE_TASK = "task"
NODE_IDENTITY = "identity"
NODE_GOAL = "goal"
NODE_CYCLE = "cycle"
NODE_LABEL = "label"

# Built-in types that still have a dedicated backing entity table (ADR-0033).
# Nodes of these types are created/deleted through their own routers so the
# table and its node mirror stay consistent; only node-only (custom) types flow
# through the generic node API. This set shrinks as Phase B collapses entities.
# ``label`` and ``cycle`` collapsed to node-only in ADR-0033 Phase B.
ENTITY_BACKED_TYPES = frozenset({NODE_PROJECT, NODE_TASK, NODE_IDENTITY, NODE_GOAL})

# Edge relationship types (canonical direction: source -> target)
REL_CONTAINS = "contains"  # parent (project/task) -> child task; replaces project_id + parent_id
REL_MEMBER_OF = "member_of"  # identity -> project
REL_ASSIGNED_TO = "assigned_to"  # task -> identity
REL_DEPENDS_ON = "depends_on"  # blocked task -> prerequisite task
REL_LABELED = "labeled"  # task -> label
REL_IN_CYCLE = "in_cycle"  # task -> cycle
REL_PART_OF = "part_of"  # project -> goal


# --- Traversal roles (registry-driven; ADR-0033 A5) --------------------------


def container_type_keys(db: Session) -> set[str]:
    """Node-type keys that play the container role (seeded: ``project``).

    Data-driven replacement for the hardcoded ``n.type == NODE_PROJECT`` checks;
    a task's "projects" are its container-role ``contains`` parents.
    """
    return {k for (k,) in db.query(NodeType.key).filter(NodeType.is_container.is_(True)).all()}


def task_type_keys(db: Session) -> set[str]:
    """Node-type keys that play the task/item role (seeded: ``task``).

    Data-driven replacement for the hardcoded ``n.type == NODE_TASK`` checks.
    """
    return {k for (k,) in db.query(NodeType.key).filter(NodeType.is_task_like.is_(True)).all()}


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


def update_node(db: Session, node_id: str, **fields) -> Node | None:
    node = db.get(Node, node_id)
    if node is None:
        return None
    columns = {"title", "status", "priority", "start_date", "due_date", "position", "is_pinned"}
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

    Used to keep the mirror consistent after bulk association deletes that
    bypass the ORM unit of work (and thus the graph_sync listener).
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
    """Ids of all transitive children via ``contains``."""
    seen: set[str] = set()
    queue: deque[str] = deque([node_id])
    while queue:
        current = queue.popleft()
        for child in children_of(db, current):
            if child.id not in seen:
                seen.add(child.id)
                queue.append(child.id)
    return seen


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


def set_label(db: Session, task_id: str, label_id: str) -> None:
    """Attach a label to a task as a ``labeled`` edge (idempotent)."""
    ensure_node(db, task_id, NODE_TASK)
    ensure_node(db, label_id, NODE_LABEL)
    add_edge(db, task_id, label_id, REL_LABELED)


def unset_label(db: Session, task_id: str, label_id: str) -> bool:
    return remove_edge(db, task_id, label_id, REL_LABELED)


def label_ids_for_task(db: Session, task_id: str) -> list[str]:
    """Ids of labels attached to a task via ``labeled`` edges."""
    rows = db.execute(select(Edge.target_id).where(Edge.source_id == task_id, Edge.rel_type == REL_LABELED)).scalars()
    return list(rows)


def labeled_ids_map(db: Session, task_ids) -> dict[str, list[str]]:
    """Batch-load ``labeled`` edges: returns ``{task_id: [label_id, ...]}`` in one query."""
    ids = set(task_ids)
    result: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return result
    rows = db.execute(
        select(Edge.source_id, Edge.target_id).where(Edge.rel_type == REL_LABELED, Edge.source_id.in_(ids))
    ).all()
    for source_id, target_id in rows:
        result[source_id].append(target_id)
    return result


# --- Labels (node-only, ADR-0033 Phase B) ------------------------------------
#
# A label is a ``Node(type="label")`` whose ``title`` holds the name and whose
# ``data`` bag holds ``color``/``type``/``description``/``decision_status``/
# ``source``. Its project scope is a ``contains`` edge (project -> label). The
# ``LabelView`` adapter exposes the historical ``Label`` attribute surface so
# ``LabelOut.model_validate`` and existing read sites keep working unchanged.


@dataclass
class LabelView:
    id: str
    project_id: str | None
    name: str
    color: str
    type: str
    description: str | None
    decision_status: str | None
    source: str | None
    created_at: datetime


def _label_view(node: Node, project_id: str | None) -> LabelView:
    data = node.data or {}
    return LabelView(
        id=node.id,
        project_id=project_id,
        name=node.title,
        color=data.get("color", "#5e6ad2"),
        type=data.get("type", "label"),
        description=data.get("description"),
        decision_status=data.get("decision_status"),
        source=data.get("source"),
        created_at=node.created_at,
    )


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


def label_project_map(db: Session, label_ids) -> dict[str, str]:
    """Batch-resolve each label's containing project id via ``contains`` edges."""
    return project_container_map(db, label_ids)


def create_label(
    db: Session,
    project_id: str,
    *,
    name: str,
    color: str = "#5e6ad2",
    type: str = "label",
    description: str | None = None,
    decision_status: str | None = None,
    source: str | None = None,
    actor: str | None = None,
) -> LabelView:
    """Create a label node contained by ``project_id`` (project -> label edge)."""
    node = create_node(
        db,
        NODE_LABEL,
        title=name,
        actor=actor,
        color=color,
        type=type,
        description=description,
        decision_status=decision_status,
        source=source,
    )
    if project_id:
        add_edge(db, project_id, node.id, REL_CONTAINS)
    return _label_view(node, project_id)


def update_label(db: Session, label_id: str, **fields) -> LabelView | None:
    """Update a label node; ``name`` maps to ``title``, the rest to ``data``."""
    node = db.get(Node, label_id)
    if node is None or node.type != NODE_LABEL:
        return None
    if "name" in fields:
        node.title = fields.pop("name")
    data = dict(node.data or {})
    for key, value in fields.items():
        data[key] = value
    node.data = data or None
    db.flush()
    project_id = label_project_map(db, [label_id]).get(label_id)
    return _label_view(node, project_id)


def delete_label(db: Session, label_id: str, *, actor: str | None = None) -> bool:
    """Delete a label node and every edge touching it (labeled + contains)."""
    node = db.get(Node, label_id)
    if node is None or node.type != NODE_LABEL:
        return False
    return delete_node(db, label_id, actor=actor)


def get_label(db: Session, label_id: str, *, project_id: str | None = None) -> LabelView | None:
    node = db.get(Node, label_id)
    if node is None or node.type != NODE_LABEL:
        return None
    pid = label_project_map(db, [label_id]).get(label_id)
    if project_id is not None and pid != project_id:
        return None
    return _label_view(node, pid)


def labels_in_project(db: Session, project_id: str) -> list[LabelView]:
    """All label nodes contained by a project, oldest first."""
    rows = (
        db.execute(
            select(Node)
            .join(Edge, Edge.target_id == Node.id)
            .where(Edge.source_id == project_id, Edge.rel_type == REL_CONTAINS, Node.type == NODE_LABEL)
            .order_by(Node.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [_label_view(node, project_id) for node in rows]


def find_label_by_name(db: Session, project_id: str, name: str, *, label_type: str | None = None) -> LabelView | None:
    for view in labels_in_project(db, project_id):
        if view.name == name and (label_type is None or view.type == label_type):
            return view
    return None


def decisions(db: Session, *, project_id: str | None = None, status: str | None = None) -> list[LabelView]:
    """Label nodes whose kind is ``decision``, newest first (filtered in Python).

    JSON ``data`` filtering is done in Python so the query stays portable across
    SQLite and PostgreSQL; decision counts are small.
    """
    nodes = db.query(Node).filter(Node.type == NODE_LABEL).order_by(Node.created_at.desc()).all()
    decision_nodes = [n for n in nodes if (n.data or {}).get("type") == "decision"]
    pmap = label_project_map(db, [n.id for n in decision_nodes])
    result: list[LabelView] = []
    for node in decision_nodes:
        pid = pmap.get(node.id)
        if project_id is not None and pid != project_id:
            continue
        if status is not None and (node.data or {}).get("decision_status") != status:
            continue
        result.append(_label_view(node, pid))
    return result


def labels_for_task(db: Session, task_id: str) -> list[LabelView]:
    """Labels attached to a task via ``labeled`` edges (single task)."""
    ids = label_ids_for_task(db, task_id)
    if not ids:
        return []
    nodes = {n.id: n for n in db.query(Node).filter(Node.id.in_(ids), Node.type == NODE_LABEL).all()}
    pmap = label_project_map(db, ids)
    return [_label_view(nodes[i], pmap.get(i)) for i in ids if i in nodes]


def labels_map(db: Session, task_ids) -> dict[str, list[LabelView]]:
    """Batch-load labels for many tasks: ``{task_id: [LabelView, ...]}``."""
    id_map = labeled_ids_map(db, task_ids)
    all_ids = {lid for lst in id_map.values() for lid in lst}
    if not all_ids:
        return {tid: [] for tid in id_map}
    nodes = {n.id: n for n in db.query(Node).filter(Node.id.in_(all_ids), Node.type == NODE_LABEL).all()}
    pmap = label_project_map(db, all_ids)
    views = {i: _label_view(nodes[i], pmap.get(i)) for i in all_ids if i in nodes}
    return {tid: [views[lid] for lid in lids if lid in views] for tid, lids in id_map.items()}


def add_to_cycle(db: Session, cycle_id: str, task_id: str) -> None:
    """Attach a task to a cycle as an ``in_cycle`` edge (idempotent)."""
    ensure_node(db, task_id, NODE_TASK)
    ensure_node(db, cycle_id, NODE_CYCLE)
    add_edge(db, task_id, cycle_id, REL_IN_CYCLE)


def remove_from_cycle(db: Session, cycle_id: str, task_id: str) -> bool:
    return remove_edge(db, task_id, cycle_id, REL_IN_CYCLE)


def task_ids_in_cycle(db: Session, cycle_id: str) -> list[str]:
    """Ids of tasks in a cycle via ``in_cycle`` edges."""
    rows = db.execute(select(Edge.source_id).where(Edge.target_id == cycle_id, Edge.rel_type == REL_IN_CYCLE)).scalars()
    return list(rows)


def tasks_in_cycle(db: Session, cycle_id: str) -> list["Task"]:
    """Task rows in a cycle via ``in_cycle`` edges."""
    ids = task_ids_in_cycle(db, cycle_id)
    if not ids:
        return []
    by_id = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def cycle_ids_for_task(db: Session, task_id: str) -> list[str]:
    """Ids of cycles a task belongs to via ``in_cycle`` edges."""
    rows = db.execute(select(Edge.target_id).where(Edge.source_id == task_id, Edge.rel_type == REL_IN_CYCLE)).scalars()
    return list(rows)


# --- Cycles (node-only, ADR-0033 Phase B) ------------------------------------
#
# A cycle is a ``Node(type="cycle")``: ``title`` = name, ``status``/``start_date``
# are real hot columns, ``end_date`` maps to the node's ``due_date`` column, and
# ``description`` lives in ``data``. Project scope is a ``contains`` edge
# (project -> cycle). ``CycleView`` exposes the historical ``Cycle`` attribute
# surface so ``CycleOut.model_validate`` and existing read sites keep working.


@dataclass
class CycleView:
    id: str
    project_id: str | None
    name: str
    description: str | None
    start_date: datetime | None
    end_date: datetime | None
    status: str
    created_at: datetime
    updated_at: datetime


def _cycle_view(node: Node, project_id: str | None) -> CycleView:
    data = node.data or {}
    return CycleView(
        id=node.id,
        project_id=project_id,
        name=node.title,
        description=data.get("description"),
        start_date=node.start_date,
        end_date=node.due_date,
        status=node.status or "draft",
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def cycle_project_map(db: Session, cycle_ids) -> dict[str, str]:
    """Batch-resolve each cycle's containing project id via ``contains`` edges."""
    return project_container_map(db, cycle_ids)


def create_cycle(
    db: Session,
    project_id: str,
    *,
    name: str,
    description: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    status: str = "draft",
    id: str | None = None,
    actor: str | None = None,
) -> CycleView:
    """Create a cycle node contained by ``project_id`` (project -> cycle edge)."""
    node = create_node(
        db,
        NODE_CYCLE,
        id=id,
        title=name,
        actor=actor,
        status=status,
        start_date=start_date,
        due_date=end_date,
        description=description,
    )
    if project_id:
        add_edge(db, project_id, node.id, REL_CONTAINS)
    return _cycle_view(node, project_id)


def update_cycle(db: Session, cycle_id: str, **fields) -> CycleView | None:
    """Update a cycle node; ``name``->title, ``end_date``->due_date, rest to columns/data."""
    node = db.get(Node, cycle_id)
    if node is None or node.type != NODE_CYCLE:
        return None
    if "name" in fields:
        node.title = fields.pop("name")
    if "start_date" in fields:
        node.start_date = fields.pop("start_date")
    if "end_date" in fields:
        node.due_date = fields.pop("end_date")
    if "status" in fields:
        node.status = fields.pop("status")
    data = dict(node.data or {})
    for key, value in fields.items():
        data[key] = value
    node.data = data or None
    db.flush()
    project_id = cycle_project_map(db, [cycle_id]).get(cycle_id)
    return _cycle_view(node, project_id)


def delete_cycle(db: Session, cycle_id: str, *, actor: str | None = None) -> bool:
    """Delete a cycle node and every edge touching it (in_cycle + contains)."""
    node = db.get(Node, cycle_id)
    if node is None or node.type != NODE_CYCLE:
        return False
    return delete_node(db, cycle_id, actor=actor)


def get_cycle(db: Session, cycle_id: str, *, project_id: str | None = None) -> CycleView | None:
    node = db.get(Node, cycle_id)
    if node is None or node.type != NODE_CYCLE:
        return None
    pid = cycle_project_map(db, [cycle_id]).get(cycle_id)
    if project_id is not None and pid != project_id:
        return None
    return _cycle_view(node, pid)


def cycles_in_project(db: Session, project_id: str) -> list[CycleView]:
    """All cycle nodes contained by a project, oldest first."""
    rows = (
        db.execute(
            select(Node)
            .join(Edge, Edge.target_id == Node.id)
            .where(Edge.source_id == project_id, Edge.rel_type == REL_CONTAINS, Node.type == NODE_CYCLE)
            .order_by(Node.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [_cycle_view(node, project_id) for node in rows]


def cycles_for_task(db: Session, task_id: str) -> list[CycleView]:
    """Cycles a task belongs to via ``in_cycle`` edges, oldest first."""
    ids = cycle_ids_for_task(db, task_id)
    if not ids:
        return []
    nodes = {n.id: n for n in db.query(Node).filter(Node.id.in_(ids), Node.type == NODE_CYCLE).all()}
    pmap = cycle_project_map(db, ids)
    views = [_cycle_view(nodes[i], pmap.get(i)) for i in ids if i in nodes]
    views.sort(key=lambda c: c.created_at)
    return views


def find_cycle_by_name(db: Session, project_id: str, name: str) -> CycleView | None:
    for view in cycles_in_project(db, project_id):
        if view.name == name:
            return view
    return None


def member_project_ids(db: Session, task_id: str) -> list[str]:
    """Ids of every project a task belongs to via incoming ``contains`` edges."""
    containers = container_type_keys(db)
    return [n.id for n in parents_of(db, task_id) if n.type in containers]


# --- Identity ↔ Project membership (member_of edges) ---


def link_membership(db: Session, identity_id: str, project_id: str) -> None:
    """Attach an identity to a project as a ``member_of`` edge (idempotent)."""
    ensure_node(db, identity_id, NODE_IDENTITY)
    ensure_node(db, project_id, NODE_PROJECT)
    add_edge(db, identity_id, project_id, REL_MEMBER_OF)


def unlink_membership(db: Session, identity_id: str, project_id: str) -> bool:
    return remove_edge(db, identity_id, project_id, REL_MEMBER_OF)


def project_ids_for_identity(db: Session, identity_id: str) -> list[str]:
    rows = db.execute(
        select(Edge.target_id).where(Edge.source_id == identity_id, Edge.rel_type == REL_MEMBER_OF)
    ).scalars()
    return list(rows)


def identity_ids_for_project(db: Session, project_id: str) -> list[str]:
    rows = db.execute(
        select(Edge.source_id).where(Edge.target_id == project_id, Edge.rel_type == REL_MEMBER_OF)
    ).scalars()
    return list(rows)


def projects_for_identity(db: Session, identity_id: str) -> list[Project]:
    ids = project_ids_for_identity(db, identity_id)
    if not ids:
        return []
    by_id = {p.id: p for p in db.query(Project).filter(Project.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def identities_for_project(db: Session, project_id: str) -> list[Identity]:
    ids = identity_ids_for_project(db, project_id)
    if not ids:
        return []
    by_id = {i.id: i for i in db.query(Identity).filter(Identity.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


# --- Project ↔ Goal membership (part_of edges) ---


def link_goal_project(db: Session, goal_id: str, project_id: str) -> None:
    """Attach a project to a goal as a ``part_of`` edge (idempotent)."""
    ensure_node(db, project_id, NODE_PROJECT)
    ensure_node(db, goal_id, NODE_GOAL)
    add_edge(db, project_id, goal_id, REL_PART_OF)


def project_ids_for_goal(db: Session, goal_id: str) -> list[str]:
    rows = db.execute(select(Edge.source_id).where(Edge.target_id == goal_id, Edge.rel_type == REL_PART_OF)).scalars()
    return list(rows)


def projects_for_goal(db: Session, goal_id: str) -> list[Project]:
    ids = project_ids_for_goal(db, goal_id)
    if not ids:
        return []
    by_id = {p.id: p for p in db.query(Project).filter(Project.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def contained_task_ids(db: Session, project_id: str) -> list[str]:
    """Ids of tasks contained by a project via outgoing ``contains`` edges."""
    tasks = task_type_keys(db)
    return [n.id for n in children_of(db, project_id) if n.type in tasks]


def unfiled_task_ids(db: Session) -> list[str]:
    """Ids of unfiled tasks: task-role nodes with no incoming ``contains`` edge (ADR-0032/0033).

    A task may legally belong to zero projects (the "unfiled" state is simply the
    absence of any project -> task ``contains`` edge). These have no container
    parent and no task parent — truly top-level tasks awaiting a home. Non-task
    node ids are filtered out by the caller when it loads ``Task`` rows.
    """
    filed = select(Edge.target_id).where(Edge.rel_type == REL_CONTAINS)
    rows = db.execute(
        select(Node.id)
        .join(NodeType, NodeType.key == Node.type)
        .where(NodeType.is_task_like.is_(True), Node.id.notin_(filed))
    ).scalars()
    return list(rows)


def create_task(db: Session, **fields) -> "Task":
    """Single entry point for creating a task (ADR-0032, no columns).

    ``project_id``/``parent_id`` are transient constructor hints (not columns);
    ``graph_sync`` turns them into ``project -> task`` / ``parent-task -> task``
    ``contains`` edges. Containment lives only in edges now.
    """
    task = Task(**fields)
    db.add(task)
    db.flush()  # graph_sync mirrors the node and creates the contains edges
    return task


def delete_task_tree(db: Session, task_id: str) -> None:
    """Delete a task and its subtask descendants (replaces ORM delete-orphan).

    A descendant linked into a project outside the root's own projects survives
    with its subtree (ADR-0032, no primary): it is unlinked from the root's
    projects instead of deleted, and lives on under its other project(s).
    Peripheral rows (comments/attachments/pull requests) still cascade via their
    own ``task_id`` FK; ``graph_sync`` drops each deleted node's touching edges.
    """
    root_projects = set(member_project_ids(db, task_id))
    doomed = [task_id, *descendants_of(db, task_id)]
    keep: set[str] = set()
    for tid in doomed[1:]:
        if tid in keep:
            continue
        if set(member_project_ids(db, tid)) - root_projects:
            keep.add(tid)
            keep |= descendants_of(db, tid)
    for tid in keep:
        for pid in root_projects:
            remove_edge(db, pid, tid, REL_CONTAINS)
    for tid in doomed:
        if tid in keep:
            continue
        task = db.get(Task, tid)
        if task is not None:
            db.delete(task)


def delete_project_and_tasks(db: Session, project) -> None:
    """Delete a project, its exclusively-owned task trees, and unlink shared tasks.

    Replaces the ``project_id`` FK ``ondelete CASCADE`` (ADR-0032, no primary): a
    top-level task belonging only to this project is deleted with its subtask tree;
    a task also linked into another project is merely unlinked from this one. The
    project node's own edges are cleaned up by ``graph_sync`` on delete.
    """
    contained = contained_task_ids(db, project.id)
    subtasks_set = subtask_ids_among(db, contained)
    for tid in contained:
        if tid in subtasks_set:
            continue  # a subtask is removed together with its parent's tree
        others = [pid for pid in member_project_ids(db, tid) if pid != project.id]
        if others:
            remove_edge(db, project.id, tid, REL_CONTAINS)
        else:
            delete_task_tree(db, tid)
    # Node-only project-scoped entities (labels, cycles: ADR-0033 Phase B) have no
    # ORM cascade; delete the nodes this project contains so they don't orphan.
    for entity in labels_in_project(db, project.id) + cycles_in_project(db, project.id):
        delete_node(db, entity.id)
    db.delete(project)


def set_parent_task(db: Session, task_id: str, parent_id: str) -> None:
    """Re-parent a task under another task: swap the incoming task->task ``contains`` edge.

    Raises ValueError if the move would create a containment cycle; callers
    should validate first (see ``get_parent_task_or_error``) to map this to a
    client error instead of a 500.
    """
    if detect_cycle(db, parent_id, task_id):
        raise ValueError(f"re-parenting {task_id} under {parent_id} would create a cycle")
    for old_parent in parents_of(db, task_id):
        if old_parent.type == NODE_TASK and old_parent.id != parent_id:
            remove_edge(db, old_parent.id, task_id, REL_CONTAINS)
    add_edge(db, parent_id, task_id, REL_CONTAINS)


def project_id_of_task(db: Session, task_id: str) -> str | None:
    """Id of the task's project: nearest ``project``-type ``contains`` ancestor (ADR-0032)."""
    node = nearest_ancestor_of_type(db, task_id, NODE_PROJECT)
    return node.id if node is not None else None


def project_of_task(db: Session, task_id: str) -> Project | None:
    """The task's project: nearest ``project``-type ``contains`` ancestor (ADR-0032)."""
    node = nearest_ancestor_of_type(db, task_id, NODE_PROJECT)
    return db.get(Project, node.id) if node is not None else None


def parent_task_map(db: Session, task_ids) -> dict[str, str]:
    """Batch ``{task_id: parent_task_id}`` for subtasks (incoming task->task contains edge)."""
    ids = set(task_ids)
    result: dict[str, str] = {}
    if not ids:
        return result
    rows = db.execute(
        select(Edge.target_id, Edge.source_id)
        .join(Node, Node.id == Edge.source_id)
        .join(NodeType, NodeType.key == Node.type)
        .where(Edge.rel_type == REL_CONTAINS, NodeType.is_task_like.is_(True), Edge.target_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
    ).all()
    for target_id, source_id in rows:
        result.setdefault(target_id, source_id)
    return result


def project_ids_map(db: Session, task_ids) -> dict[str, list[str]]:
    """Batch ``{task_id: [project_id, ...]}`` from incoming project->task contains edges.

    Ordered like ``parents_of`` (edge position, then created_at) so element 0 is the
    same deterministic "compat project" that ``nearest_ancestor_of_type`` would pick
    among direct parents.
    """
    ids = set(task_ids)
    result: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return result
    rows = db.execute(
        select(Edge.target_id, Edge.source_id)
        .join(Node, Node.id == Edge.source_id)
        .join(NodeType, NodeType.key == Node.type)
        .where(Edge.rel_type == REL_CONTAINS, NodeType.is_container.is_(True), Edge.target_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
    ).all()
    for target_id, source_id in rows:
        result[target_id].append(source_id)
    return result


def tasks_in_project(db: Session, project_id: str) -> list["Task"]:
    """Task rows contained by a project via ``contains`` edges (ADR-0032, no primary).

    Replaces ``project.tasks`` / ``WHERE Task.project_id == pid`` reads: naturally
    includes cross-project members. Order is not guaranteed; callers that need a
    specific order should sort explicitly.
    """
    ids = contained_task_ids(db, project_id)
    if not ids:
        return []
    by_id = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def child_task_ids_map(db: Session, parent_ids) -> dict[str, list[str]]:
    """Batch-load ``{parent_id: [child_task_id, ...]}`` for many parents in one query.

    Works for both project parents (-> their tasks) and task parents (-> subtasks),
    since both use ``contains`` edges.
    """
    ids = set(parent_ids)
    result: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return result
    rows = db.execute(
        select(Edge.source_id, Edge.target_id)
        .where(Edge.rel_type == REL_CONTAINS, Edge.source_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
    ).all()
    for source_id, target_id in rows:
        result[source_id].append(target_id)
    return result


def subtasks(db: Session, task_id: str) -> list["Task"]:
    """Subtask rows of a task via task->task ``contains`` edges (replaces ``task.subtasks``)."""
    ids = contained_task_ids(db, task_id)
    if not ids:
        return []
    by_id = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def subtask_ids_among(db: Session, task_ids) -> set[str]:
    """Subset of ``task_ids`` that are subtasks (have an incoming task->task ``contains`` edge).

    A task always has a project->task edge too, so the parent node type must be
    ``task`` to distinguish a real subtask relationship. Replaces ``t.parent_id is
    not None`` checks on an already-loaded set of tasks.
    """
    ids = set(task_ids)
    if not ids:
        return set()
    rows = db.execute(
        select(Edge.target_id)
        .join(Node, Node.id == Edge.source_id)
        .join(NodeType, NodeType.key == Node.type)
        .where(Edge.rel_type == REL_CONTAINS, NodeType.is_task_like.is_(True), Edge.target_id.in_(ids))
    ).scalars()
    return set(rows)


def top_level_task_filter():
    """SQL filter expression selecting top-level tasks (not a subtask of any task).

    A subtask is the target of a ``contains`` edge whose source is a task node;
    top-level tasks have no such edge. Replaces ``Task.parent_id == None`` in queries.
    """
    subquery = (
        select(Edge.target_id)
        .join(Node, Node.id == Edge.source_id)
        .join(NodeType, NodeType.key == Node.type)
        .where(Edge.rel_type == REL_CONTAINS, NodeType.is_task_like.is_(True))
    )
    return Task.id.notin_(subquery)


def detect_cycle(db: Session, source_id: str, target_id: str) -> bool:
    """Would adding ``contains`` edge source -> target create a cycle?

    True if source == target, or if source is already a descendant of target
    (which would close a loop once target also contains source).
    """
    if source_id == target_id:
        return True
    return source_id in descendants_of(db, target_id)
