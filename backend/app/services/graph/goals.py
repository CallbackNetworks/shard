"""Goals (node-only, ADR-0033 Phase B).

A goal is a ``Node(type="goal")``: ``title`` = title, ``status`` is a real hot
column, ``target_date`` maps to the node's ``due_date`` column, and
``description`` lives in ``data``. Unlike labels/cycles a goal is NOT project-
scoped — projects link to it via ``part_of`` edges (project -> goal), so a goal
has no containing ``contains`` edge. ``GoalView`` exposes the historical
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
    REL_PART_OF,
    add_edge,
    create_node,
    delete_node,
    ensure_node,
)
from app.services.graph.projects import ProjectView, projects_by_ids


def link_goal_project(db: Session, goal_id: str, project_id: str) -> None:
    """Attach a project to a goal as a ``part_of`` edge (idempotent)."""
    ensure_node(db, project_id, NODE_PROJECT)
    ensure_node(db, goal_id, NODE_GOAL)
    add_edge(db, project_id, goal_id, REL_PART_OF)


def project_ids_for_goal(db: Session, goal_id: str) -> list[str]:
    rows = db.execute(select(Edge.source_id).where(Edge.target_id == goal_id, Edge.rel_type == REL_PART_OF)).scalars()
    return list(rows)


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
        status=node.status or "active",
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
    """Create a top-level goal node (no project containment; see ``part_of``)."""
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
    """Delete a goal node and every edge touching it (part_of)."""
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
        query = query.filter(Node.status == status)
    rows = query.order_by(Node.created_at.desc()).all()
    return [_goal_view(node) for node in rows]
