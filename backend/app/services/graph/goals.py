"""Goals (node-only; ADR-0033 Phase B, container role ADR-0041).

A goal is a ``Node(type="goal")``: ``title`` = title, ``status`` is a real hot
column, ``target_date`` maps to the node's ``due_date`` column, and
``description`` lives in ``data``. Since ADR-0041 a goal carries the ``container``
role: the projects (and tasks) it groups are its **outgoing** ``contains``
children (``goal -> project`` / ``goal -> task``), replacing the retired
one-off ``part_of`` (project -> goal) edge. ``GoalView`` exposes the historical
``Goal`` attribute surface so ``GoalOut.model_validate`` keeps working.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.graph.core import (
    NODE_GOAL,
    NODE_PROJECT,
    REL_CONTAINS,
    add_edge,
    container_status,
    container_status_filter,
    create_node,
    delete_node,
    ensure_node,
)
from app.services.graph.projects import ProjectView, projects_by_ids
from app.services.graph.tasks import container_subtree_stats


def link_goal_project(db: Session, goal_id: str, project_id: str) -> None:
    """Group a project under a goal as a ``goal -> project`` ``contains`` edge (idempotent)."""
    ensure_node(db, project_id, NODE_PROJECT)
    ensure_node(db, goal_id, NODE_GOAL)
    add_edge(db, goal_id, project_id, REL_CONTAINS)


def project_ids_for_goal(db: Session, goal_id: str) -> list[str]:
    """Ids of the literal ``project`` nodes a goal contains (excludes directly-held tasks)."""
    rows = db.execute(
        select(Edge.target_id)
        .join(Node, Node.id == Edge.target_id)
        .where(Edge.source_id == goal_id, Edge.rel_type == REL_CONTAINS, Node.type == NODE_PROJECT)
        .order_by(Edge.position, Edge.created_at)
    ).scalars()
    return list(rows)


def goal_subtree_progress(db: Session, goal_id: str) -> float:
    """Task-weighted progress over the whole goal subtree (ADR-0041).

    A goal is just a container, so the rule it introduced now lives in
    ``container_subtree_stats`` and every container reads the same figure
    (ADR-0065); this stays as the goal-shaped name its callers already use.
    """
    return container_subtree_stats(db, goal_id).progress


def projects_for_goal(db: Session, goal_id: str) -> list[ProjectView]:
    ids = project_ids_for_goal(db, goal_id)
    if not ids:
        return []
    by_id = projects_by_ids(db, ids)
    return [by_id[i] for i in ids if i in by_id]


@dataclass
class GoalView:
    id: str
    title: str
    description: str | None
    status: str
    target_date: datetime | None
    created_at: datetime
    updated_at: datetime


def _goal_view(node: Node) -> GoalView:
    data = node.data or {}
    return GoalView(
        id=node.id,
        title=node.title,
        description=data.get("description"),
        status=container_status(node),
        target_date=node.due_date,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def create_goal(
    db: Session,
    *,
    title: str,
    description: str | None = None,
    target_date: datetime | None = None,
    status: str = "active",
    actor: str | None = None,
) -> GoalView:
    """Create a top-level goal node (a container; children are attached via ``contains``)."""
    node = create_node(
        db,
        NODE_GOAL,
        title=title,
        actor=actor,
        status=status,
        due_date=target_date,
        description=description,
    )
    return _goal_view(node)


def update_goal(db: Session, goal_id: str, **fields) -> GoalView | None:
    """Update a goal node; ``title``->title, ``target_date``->due_date, rest to columns/data."""
    node = db.get(Node, goal_id)
    if node is None or node.type != NODE_GOAL:
        return None
    if "title" in fields:
        node.title = fields.pop("title")
    if "target_date" in fields:
        node.due_date = fields.pop("target_date")
    if "status" in fields:
        node.status = fields.pop("status")
    data = dict(node.data or {})
    for key, value in fields.items():
        data[key] = value
    node.data = data or None
    db.flush()
    return _goal_view(node)


def delete_goal(db: Session, goal_id: str, *, actor: str | None = None) -> bool:
    """Delete a goal node and every edge touching it (its ``contains`` children survive)."""
    node = db.get(Node, goal_id)
    if node is None or node.type != NODE_GOAL:
        return False
    return delete_node(db, goal_id, actor=actor)


def get_goal(db: Session, goal_id: str) -> GoalView | None:
    node = db.get(Node, goal_id)
    if node is None or node.type != NODE_GOAL:
        return None
    return _goal_view(node)


def all_goals(db: Session, *, status: str | None = None) -> list[GoalView]:
    """All goal nodes, newest first, optionally filtered by status."""
    query = db.query(Node).filter(Node.type == NODE_GOAL)
    if status is not None:
        query = query.filter(container_status_filter(status))
    rows = query.order_by(Node.created_at.desc()).all()
    return [_goal_view(node) for node in rows]
