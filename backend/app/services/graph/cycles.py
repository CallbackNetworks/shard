"""Cycles (node-only, ADR-0033 Phase B).

A cycle is a ``Node(type="cycle")``: ``title`` = name, ``status``/``start_date``
are real hot columns, ``end_date`` maps to the node's ``due_date`` column, and
``description`` lives in ``data``. Project scope is a ``contains`` edge
(project -> cycle). ``CycleView`` exposes the historical ``Cycle`` attribute
surface so ``CycleOut.model_validate`` and existing read sites keep working.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.graph.core import (
    NODE_CYCLE,
    NODE_TASK,
    REL_CONTAINS,
    REL_IN_CYCLE,
    add_edge,
    create_node,
    delete_node,
    ensure_node,
    project_container_map,
    remove_edge,
)
from app.services.graph.tasks import TaskView, task_views_for_ids


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


def tasks_in_cycle(db: Session, cycle_id: str) -> list[TaskView]:
    """Task views in a cycle via ``in_cycle`` edges."""
    ids = task_ids_in_cycle(db, cycle_id)
    return task_views_for_ids(db, ids)


def cycle_ids_for_task(db: Session, task_id: str) -> list[str]:
    """Ids of cycles a task belongs to via ``in_cycle`` edges."""
    rows = db.execute(select(Edge.target_id).where(Edge.source_id == task_id, Edge.rel_type == REL_IN_CYCLE)).scalars()
    return list(rows)


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
