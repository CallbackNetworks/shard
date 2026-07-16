"""Graph layer for the unified node/edge model (see ADR-0032).

Single place that owns node/edge CRUD and traversal. Callers should go through
these helpers rather than querying ``Node`` / ``Edge`` directly so that cycle
prevention and the "nearest ancestor" rules stay consistent.
"""

from collections import defaultdict, deque

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Edge, Identity, Label, Node, Project, Task

# Node types
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
REL_PART_OF = "part_of"  # project -> goal


# --- Node CRUD ---------------------------------------------------------------


def create_node(db: Session, node_type: str, *, id: str | None = None, title: str = "", **fields) -> Node:
    """Create a node. Unknown keyword fields are folded into ``data``."""
    columns = {"status", "priority", "start_date", "due_date", "position", "is_pinned"}
    col_values = {k: fields.pop(k) for k in list(fields) if k in columns}
    node = Node(type=node_type, title=title, data=fields or None, **col_values)
    if id is not None:
        node.id = id
    db.add(node)
    db.flush()
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


def delete_node(db: Session, node_id: str) -> bool:
    """Delete a node and every edge touching it."""
    node = db.get(Node, node_id)
    if node is None:
        return False
    db.query(Edge).filter((Edge.source_id == node_id) | (Edge.target_id == node_id)).delete(synchronize_session=False)
    db.delete(node)
    db.flush()
    return True


# --- Edge CRUD ---------------------------------------------------------------


def add_edge(
    db: Session, source_id: str, target_id: str, rel_type: str, *, position: int = 0, data: dict | None = None
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


def remove_edge(db: Session, source_id: str, target_id: str, rel_type: str) -> bool:
    deleted = (
        db.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .delete(synchronize_session=False)
    )
    db.flush()
    return bool(deleted)


# --- Traversal ---------------------------------------------------------------


def neighbors(db: Session, node_id: str, rel_type: str, *, direction: str = "out") -> list[Node]:
    """Return nodes connected to ``node_id`` by ``rel_type``.

    direction "out": nodes this node points at (targets).
    direction "in": nodes pointing at this node (sources).
    """
    if direction == "out":
        stmt = (
            select(Node)
            .join(Edge, Edge.target_id == Node.id)
            .where(Edge.source_id == node_id, Edge.rel_type == rel_type)
            .order_by(Edge.position)
        )
    else:
        stmt = (
            select(Node)
            .join(Edge, Edge.source_id == Node.id)
            .where(Edge.target_id == node_id, Edge.rel_type == rel_type)
            .order_by(Edge.position)
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


def labels_for_task(db: Session, task_id: str) -> list[Label]:
    """Label rows attached to a task via ``labeled`` edges (single task)."""
    ids = label_ids_for_task(db, task_id)
    if not ids:
        return []
    by_id = {label.id: label for label in db.query(Label).filter(Label.id.in_(ids)).all()}
    return [by_id[i] for i in ids if i in by_id]


def labels_map(db: Session, task_ids) -> dict[str, list[Label]]:
    """Batch-load labels for many tasks: ``{task_id: [Label, ...]}`` in two queries."""
    id_map = labeled_ids_map(db, task_ids)
    all_ids = {lid for lst in id_map.values() for lid in lst}
    labels = {lb.id: lb for lb in db.query(Label).filter(Label.id.in_(all_ids)).all()} if all_ids else {}
    return {tid: [labels[lid] for lid in lids if lid in labels] for tid, lids in id_map.items()}


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


def member_project_ids(db: Session, task_id: str) -> list[str]:
    """Ids of every project a task belongs to via incoming ``contains`` edges."""
    return [n.id for n in parents_of(db, task_id) if n.type == NODE_PROJECT]


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
    return [n.id for n in children_of(db, project_id) if n.type == NODE_TASK]


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


def project_task_id_map(db: Session, project_ids) -> dict[str, list[str]]:
    """Batch-load ``{project_id: [task_id, ...]}`` for many projects in one query."""
    ids = set(project_ids)
    result: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return result
    rows = db.execute(
        select(Edge.source_id, Edge.target_id).where(Edge.rel_type == REL_CONTAINS, Edge.source_id.in_(ids))
    ).all()
    # Only project->task contains edges (a task's subtasks also use contains, but
    # their source is a task node, never in ``project_ids``).
    for source_id, target_id in rows:
        result[source_id].append(target_id)
    return result


def detect_cycle(db: Session, source_id: str, target_id: str) -> bool:
    """Would adding ``contains`` edge source -> target create a cycle?

    True if source == target, or if source is already a descendant of target
    (which would close a loop once target also contains source).
    """
    if source_id == target_id:
        return True
    return source_id in descendants_of(db, target_id)
