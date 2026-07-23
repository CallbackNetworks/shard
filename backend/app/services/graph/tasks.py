"""Tasks (node-backed, ADR-0033 Phase B, B5).

A task is a ``Node(type="task")`` whose hot columns are real (title/status/
priority/start_date/due_date/position/is_pinned/created_at/updated_at) and whose
non-hot fields live in ``data`` (written by ``create_task``/``update_task``).
``TaskView`` exposes the historical ``Task`` attribute surface — every
scalar plus the relationship-like ``comments``/``pull_requests``/
``assigned_agent`` — so ``TaskOut.model_validate`` and ``enrich_task`` work
against it unchanged. Relationship-like attributes are lazy and need the ``db``
the view was built with.
"""

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node, NodeType
from app.services.graph.core import (
    _TASK_DATA_SCALARS,
    NODE_PROJECT,
    NODE_TASK,
    REL_CONTAINS,
    _apply_task_data_defaults,
    _iso,
    _parse_dt,
    add_edge,
    container_type_keys,
    delete_node,
    descendants_of,
    detect_cycle,
    ensure_node,
    nearest_ancestor_of_type,
    parents_of,
    remove_edge,
    task_type_keys,
)
from app.services.graph.projects import ProjectView, _project_view, contained_task_ids


def member_project_ids(db: Session, task_id: str) -> list[str]:
    """Ids of every literal ``project`` a task belongs to via incoming ``contains`` edges.

    Deliberately restricted to the built-in ``project`` type (not the generic
    ``is_container`` role): this feeds the compat ``TaskOut.project_id``/``project_ids``
    the frontend consumes as real projects (``/projects/{id}``). A custom container's
    id must NOT leak here or the UI would 404 (ADR-0034). Use ``member_container_ids``
    for the generic containment superset.
    """
    return [n.id for n in parents_of(db, task_id) if n.type == NODE_PROJECT]


def member_container_ids(db: Session, task_id: str) -> list[str]:
    """Ids of every container (``is_container`` role) a task belongs to via ``contains``.

    The generic superset of ``member_project_ids`` — includes literal projects and
    any user-defined container type (ADR-0034). Feeds the generic ``container_ids``
    compat field and the delete-orphan "does another container keep this alive?" test.
    """
    containers = container_type_keys(db)
    return [n.id for n in parents_of(db, task_id) if n.type in containers]


class TaskView:
    """Read-facing view of a task node mirroring the ``Task`` ORM surface."""

    def __init__(self, node: Node, db: Session | None = None):
        self._db = db
        data = node.data or {}
        self.id = node.id
        self.type = node.type  # "task" or a user-defined task-like type (ADR-0035)
        self.title = node.title
        self.status = node.status or "todo"
        self.priority = node.priority or "medium"
        self.start_date = node.start_date
        self.due_date = node.due_date
        self.position = node.position or 0
        self.is_pinned = bool(node.is_pinned)
        self.created_at = node.created_at
        self.updated_at = node.updated_at
        self.reminder_sent_at = _parse_dt(data.get("reminder_sent_at"))
        for key in _TASK_DATA_SCALARS:
            setattr(self, key, data.get(key))

    @property
    def comments(self):
        from app.models import Comment

        if self._db is None:
            return []
        return self._db.query(Comment).filter(Comment.task_id == self.id).order_by(Comment.created_at.asc()).all()

    @property
    def pull_requests(self):
        from app.models import TaskPullRequest

        if self._db is None:
            return []
        return self._db.query(TaskPullRequest).filter(TaskPullRequest.task_id == self.id).all()

    @property
    def assigned_agent(self):
        from app.models import ApiKey

        if self._db is None or not self.assigned_agent_key_id:
            return None
        return self._db.get(ApiKey, self.assigned_agent_key_id)


def task_view(node: Node, db: Session | None = None) -> TaskView:
    return TaskView(node, db)


def get_task(db: Session, task_id: str) -> TaskView | None:
    node = db.get(Node, task_id)
    # Role-based: built-in ``task`` plus any user-defined task-like type (ADR-0035).
    if node is None or node.type not in task_type_keys(db):
        return None
    return TaskView(node, db)


def task_views_by_ids(db: Session, task_ids) -> dict[str, TaskView]:
    """Batch-load ``{task_id: TaskView}`` for task-role nodes among ``task_ids`` (ADR-0035)."""
    ids = set(task_ids)
    if not ids:
        return {}
    nodes = db.query(Node).filter(Node.id.in_(ids), Node.type.in_(task_type_keys(db))).all()
    return {n.id: TaskView(n, db) for n in nodes}


def task_views_for_ids(db: Session, task_ids) -> list[TaskView]:
    """TaskViews for ``task_ids`` preserving input order (missing ids dropped)."""
    by_id = task_views_by_ids(db, task_ids)
    return [by_id[i] for i in task_ids if i in by_id]


_TASK_HOT_COLUMNS = ("title", "status", "priority", "start_date", "due_date", "position", "is_pinned")


def _apply_task_fields(node: Node, fields: dict, *, creating: bool) -> None:
    """Write task fields onto a task node: hot columns direct, the rest into ``data``.

    ``reminder_sent_at`` is a datetime stored as an ISO string (JSON has no datetime
    type); ``created_at``/``updated_at`` are real node columns.
    """
    f = dict(fields)
    if creating:
        node.status = "todo"
        node.priority = "medium"
        node.position = 0
        node.is_pinned = False
    if "created_at" in f:
        node.created_at = f.pop("created_at")
    if "updated_at" in f:
        node.updated_at = f.pop("updated_at")
    for col in _TASK_HOT_COLUMNS:
        if col in f:
            value = f.pop(col)
            if col == "position":
                value = value or 0
            elif col == "is_pinned":
                value = bool(value)
            setattr(node, col, value)
    data = dict(node.data or {})
    if creating:
        _apply_task_data_defaults(data)
    for key, value in f.items():
        data[key] = _iso(value) if key == "reminder_sent_at" else value
    node.data = data or None


def create_task(
    db: Session, *, project_id: str | None = None, parent_id: str | None = None, id: str | None = None, **fields
) -> TaskView:
    """Single entry point for creating a task node (ADR-0032/0033, node-only).

    ``project_id``/``parent_id`` become ``project -> task`` / ``parent-task -> task``
    ``contains`` edges; containment lives only in edges now.
    """
    node = Node(id=id or str(uuid.uuid4()), type=NODE_TASK)
    _apply_task_fields(node, fields, creating=True)
    db.add(node)
    db.flush()
    if project_id:
        ensure_node(db, project_id, NODE_PROJECT)
        add_edge(db, project_id, node.id, REL_CONTAINS)
    if parent_id:
        ensure_node(db, parent_id, NODE_TASK)
        add_edge(db, parent_id, node.id, REL_CONTAINS)
    return TaskView(node, db)


def update_task(db: Session, task_id: str, **fields) -> TaskView | None:
    """Update a task node's hot columns / ``data`` fields (ADR-0033, node-only)."""
    node = db.get(Node, task_id)
    if node is None or node.type not in task_type_keys(db):
        return None
    _apply_task_fields(node, fields, creating=False)
    db.flush()
    return TaskView(node, db)


def find_task_by_callback_token(db: Session, token: str) -> TaskView | None:
    """Locate a task by its ``callback_token`` (stored in ``data``).

    Scans task nodes and filters in Python: the token lives in the JSON ``data``
    bag (no indexed column) — dialect-portable and fine at personal-tool scale.
    """
    for node in db.query(Node).filter(Node.type.in_(task_type_keys(db))).all():
        if (node.data or {}).get("callback_token") == token:
            return TaskView(node, db)
    return None


def find_task_by_external(db: Session, provider: str, external_id: str, repo: str) -> TaskView | None:
    """Locate a task by its external issue identity (provider/id/repo in ``data``)."""
    for node in db.query(Node).filter(Node.type.in_(task_type_keys(db))).all():
        data = node.data or {}
        if (
            data.get("external_provider") == provider
            and data.get("external_id") == external_id
            and data.get("external_repo") == repo
        ):
            return TaskView(node, db)
    return None


def delete_task_tree(db: Session, task_id: str) -> None:
    """Delete a task and its subtask descendants (replaces ORM delete-orphan).

    A descendant linked into a project outside the root's own projects survives
    with its subtree (ADR-0032, no primary): it is unlinked from the root's
    projects instead of deleted, and lives on under its other project(s).
    Peripheral rows (comments/attachments/pull requests) and the node's touching
    edges are cleaned up by ``_delete_task_node`` -> ``delete_node``.
    """
    # Use the generic container set (ADR-0034): a descendant kept alive by ANY other
    # container — a literal project or a user-defined container type — survives.
    root_containers = set(member_container_ids(db, task_id))
    doomed = [task_id, *descendants_of(db, task_id)]
    keep: set[str] = set()
    for tid in doomed[1:]:
        if tid in keep:
            continue
        if set(member_container_ids(db, tid)) - root_containers:
            keep.add(tid)
            keep |= descendants_of(db, tid)
    for tid in keep:
        for pid in root_containers:
            remove_edge(db, pid, tid, REL_CONTAINS)
    for tid in doomed:
        if tid in keep:
            continue
        _delete_task_node(db, tid)


def _delete_task_node(db: Session, task_id: str) -> None:
    """Delete a task node plus its peripheral rows (comments/attachments/PRs/...).

    Node-only tasks have no ORM delete-orphan cascade; the peripheral tables FK to
    ``nodes.id`` with ``ondelete CASCADE`` but SQLite does not enforce that without
    ``PRAGMA foreign_keys=ON``, so clean them explicitly for dialect-independence.
    """
    from app.models import Attachment, Comment, RecurrenceRule, TaskPullRequest, WebhookEvent

    node = db.get(Node, task_id)
    if node is None or node.type not in task_type_keys(db):
        return
    for model in (Comment, Attachment, TaskPullRequest, WebhookEvent):
        db.query(model).filter(model.task_id == task_id).delete(synchronize_session=False)
    db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task_id).delete(synchronize_session=False)
    delete_node(db, task_id)


def delete_project_and_tasks(db: Session, project) -> None:
    """Delete a project, its exclusively-owned task trees, and unlink shared tasks.

    Replaces the ``project_id`` FK ``ondelete CASCADE`` (ADR-0032, no primary): a
    top-level task belonging only to this project is deleted with its subtask tree;
    a task also linked into another project is merely unlinked from this one. The
    project node itself and its touching edges are dropped by ``delete_node``.
    """
    # Deferred imports: labels/cycles sit above tasks in the package dependency
    # order (cycles imports tasks), so importing them at module load would cycle.
    from app.services.graph.cycles import cycles_in_project
    from app.services.graph.labels import labels_in_project

    contained = contained_task_ids(db, project.id)
    subtasks_set = subtask_ids_among(db, contained)
    for tid in contained:
        if tid in subtasks_set:
            continue  # a subtask is removed together with its parent's tree
        others = [pid for pid in member_container_ids(db, tid) if pid != project.id]
        if others:
            remove_edge(db, project.id, tid, REL_CONTAINS)
        else:
            delete_task_tree(db, tid)
    # Node-only project-scoped entities (labels, cycles: ADR-0033 Phase B) have no
    # ORM cascade; delete the nodes this project contains so they don't orphan.
    for entity in labels_in_project(db, project.id) + cycles_in_project(db, project.id):
        delete_node(db, entity.id)
    # The project itself is node-only (ADR-0033 Phase B, B6): delete_node drops the
    # node and every touching edge (contains/member_of/part_of).
    delete_node(db, project.id)


def set_parent_task(db: Session, task_id: str, parent_id: str) -> None:
    """Re-parent a task under another task: swap the incoming task->task ``contains`` edge.

    Raises ValueError if the move would create a containment cycle; callers
    should validate first (see ``get_parent_task_or_error``) to map this to a
    client error instead of a 500.
    """
    if detect_cycle(db, parent_id, task_id):
        raise ValueError(f"re-parenting {task_id} under {parent_id} would create a cycle")
    tasks = task_type_keys(db)
    for old_parent in parents_of(db, task_id):
        if old_parent.type in tasks and old_parent.id != parent_id:
            remove_edge(db, old_parent.id, task_id, REL_CONTAINS)
    add_edge(db, parent_id, task_id, REL_CONTAINS)


def project_id_of_task(db: Session, task_id: str) -> str | None:
    """Id of the task's project: nearest ``project``-type ``contains`` ancestor (ADR-0032)."""
    node = nearest_ancestor_of_type(db, task_id, NODE_PROJECT)
    return node.id if node is not None else None


def project_of_task(db: Session, task_id: str) -> ProjectView | None:
    """The task's project: nearest ``project``-type ``contains`` ancestor (ADR-0032)."""
    node = nearest_ancestor_of_type(db, task_id, NODE_PROJECT)
    return _project_view(node) if node is not None else None


def parent_task_map(db: Session, task_ids) -> dict[str, str]:
    """Batch ``{task_id: parent_task_id}`` for subtasks (incoming task->task contains edge)."""
    ids = set(task_ids)
    result: dict[str, str] = {}
    if not ids:
        return result
    rows = db.execute(
        select(Edge.target_id, Edge.source_id)
        .join(Node, Node.id == Edge.source_id)
        .where(Edge.rel_type == REL_CONTAINS, Node.type.in_(task_type_keys(db)), Edge.target_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
    ).all()
    for target_id, source_id in rows:
        result.setdefault(target_id, source_id)
    return result


def project_ids_map(db: Session, task_ids) -> dict[str, list[str]]:
    """Batch ``{task_id: [project_id, ...]}`` from incoming project->task contains edges.

    Restricted to the literal ``project`` type (not the ``is_container`` role) so the
    compat ``TaskOut.project_id``/``project_ids`` can never carry a custom container id
    that the frontend would 404 on (ADR-0034). Use ``container_ids_map`` for the generic
    containment superset.

    Ordered like ``parents_of`` (edge position, then created_at) so element 0 is the
    same deterministic "compat project" that ``nearest_ancestor_of_type`` would pick
    among direct parents.
    """
    return _containment_ids_map(db, task_ids, source_filter=Node.type == NODE_PROJECT)


def container_ids_map(db: Session, task_ids) -> dict[str, list[str]]:
    """Batch ``{task_id: [container_id, ...]}`` from incoming container->task contains edges.

    Generic superset of ``project_ids_map``: any ``is_container``-role parent (literal
    projects plus user-defined container types). Feeds the generic ``TaskOut.container_ids``
    (ADR-0034). Same deterministic ordering as ``project_ids_map``.
    """
    return _containment_ids_map(db, task_ids, source_filter=Node.type.in_(container_type_keys(db)))


def _containment_ids_map(db: Session, task_ids, *, source_filter) -> dict[str, list[str]]:
    """Shared batch ``{task_id: [parent_id, ...]}`` for incoming ``contains`` edges.

    ``source_filter`` narrows the parent (source) node — a literal type check for the
    compat project map, or the ``is_container`` role for the generic container map.
    """
    ids = set(task_ids)
    result: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return result
    rows = db.execute(
        select(Edge.target_id, Edge.source_id)
        .join(Node, Node.id == Edge.source_id)
        .join(NodeType, NodeType.key == Node.type)
        .where(Edge.rel_type == REL_CONTAINS, source_filter, Edge.target_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
    ).all()
    for target_id, source_id in rows:
        result[target_id].append(source_id)
    return result


def tasks_in_project(db: Session, project_id: str) -> list["TaskView"]:
    """Task views contained by a project via ``contains`` edges (ADR-0032, no primary).

    Replaces ``project.tasks`` / ``WHERE Task.project_id == pid`` reads: naturally
    includes cross-project members. Order is not guaranteed; callers that need a
    specific order should sort explicitly.
    """
    return task_views_for_ids(db, contained_task_ids(db, project_id))


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


def subtasks(db: Session, task_id: str) -> list["TaskView"]:
    """Subtask views of a task via task->task ``contains`` edges (replaces ``task.subtasks``)."""
    return task_views_for_ids(db, contained_task_ids(db, task_id))


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
        .where(Edge.rel_type == REL_CONTAINS, Node.type.in_(task_type_keys(db)), Edge.target_id.in_(ids))
    ).scalars()
    return set(rows)


def top_level_task_filter(db: Session):
    """SQL filter expression selecting top-level tasks (not a subtask of any task).

    A subtask is the target of a ``contains`` edge whose source is a task-role node;
    top-level tasks have no such edge. Replaces ``Task.parent_id == None`` in queries.
    Takes ``db`` to resolve the task-role key set (ADR-0040: roles are read in Python,
    not via a JSON operator in the subquery).
    """
    subquery = (
        select(Edge.target_id)
        .join(Node, Node.id == Edge.source_id)
        .where(Edge.rel_type == REL_CONTAINS, Node.type.in_(task_type_keys(db)))
    )
    return Node.id.notin_(subquery)
