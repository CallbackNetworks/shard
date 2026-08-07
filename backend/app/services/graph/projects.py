"""Projects (node-only, ADR-0033 Phase B, B6).

A project is a ``Node(type="project")``: ``title`` = name and ``status`` is a
real hot column; every other field (description/share_token/share_expires_at/
allow_guest_notes/agent_instructions/repo_url/wip_limits) lives in ``data``.
``share_expires_at`` is a datetime stored as an ISO string in JSON. Projects are
top-level containers — tasks/labels/cycles attach to them via ``contains`` edges
and identities via ``member_of`` — so a project has no incoming containment edge
of its own. ``ProjectView`` exposes the historical ``Project`` attribute surface
so ``ProjectOut.model_validate`` keeps working. This was the last entity-backed
type; after B6 the ``projects`` table is dropped and ``graph_sync`` is retired.
"""

import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.graph.core import (
    NODE_PROJECT,
    REL_CONTAINS,
    _iso,
    _parse_dt,
    children_of,
    container_type_keys,
    create_node,
    task_type_keys,
)


@dataclass
class ProjectView:
    id: str
    name: str
    description: str | None
    status: str
    share_token: str | None
    share_expires_at: datetime | None
    allow_guest_notes: bool
    agent_instructions: str | None
    repo_url: str | None
    wip_limits: dict | None
    created_at: datetime
    updated_at: datetime


def _project_view(node: Node) -> ProjectView:
    data = node.data or {}
    return ProjectView(
        id=node.id,
        name=node.title,
        description=data.get("description"),
        status=node.status or "active",
        share_token=data.get("share_token"),
        share_expires_at=_parse_dt(data.get("share_expires_at")),
        allow_guest_notes=bool(data.get("allow_guest_notes", False)),
        agent_instructions=data.get("agent_instructions"),
        repo_url=data.get("repo_url"),
        wip_limits=data.get("wip_limits"),
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def create_project(
    db: Session,
    *,
    name: str,
    description: str | None = None,
    agent_instructions: str | None = None,
    repo_url: str | None = None,
    wip_limits: dict | None = None,
    status: str = "active",
    id: str | None = None,
    actor: str | None = None,
) -> ProjectView:
    """Create a top-level project node (the container for tasks/labels/cycles)."""
    node = create_node(
        db,
        NODE_PROJECT,
        id=id,
        title=name,
        actor=actor,
        status=status,
        description=description,
        share_token=str(uuid.uuid4()),
        share_expires_at=None,
        allow_guest_notes=False,
        agent_instructions=agent_instructions,
        repo_url=repo_url,
        wip_limits=wip_limits,
    )
    return _project_view(node)


def update_project(db: Session, project_id: str, **fields) -> ProjectView | None:
    """Update a project node; ``name``->title, ``status`` hot, everything else into ``data``."""
    node = db.get(Node, project_id)
    if node is None or node.type != NODE_PROJECT:
        return None
    if "name" in fields:
        node.title = fields.pop("name")
    if "status" in fields:
        node.status = fields.pop("status")
    data = dict(node.data or {})
    for key, value in fields.items():
        data[key] = _iso(value)
    node.data = data or None
    db.flush()
    return _project_view(node)


def get_project(db: Session, project_id: str) -> ProjectView | None:
    node = db.get(Node, project_id)
    if node is None or node.type != NODE_PROJECT:
        return None
    return _project_view(node)


def all_projects(db: Session, *, status: str | None = None) -> list[ProjectView]:
    """All project nodes, newest first, optionally filtered by status."""
    query = db.query(Node).filter(Node.type == NODE_PROJECT)
    if status is not None:
        query = query.filter(Node.status == status)
    rows = query.order_by(Node.created_at.desc()).all()
    return [_project_view(node) for node in rows]


def projects_by_ids(db: Session, project_ids) -> dict[str, ProjectView]:
    """Batch-load ``{project_id: ProjectView}`` for project-type nodes among ``project_ids``."""
    ids = set(project_ids)
    if not ids:
        return {}
    nodes = db.query(Node).filter(Node.id.in_(ids), Node.type == NODE_PROJECT).all()
    return {n.id: _project_view(n) for n in nodes}


def container_view(db: Session, node_id: str) -> ProjectView | None:
    """Build a ``ProjectView`` for any container node, regardless of its type.

    ``_project_view`` reads only generic fields (title/status/data), so a
    user-defined container (ADR-0034/0039) can reuse the project serialization
    path for its share facade. Not type-filtered — the caller has already
    resolved capability via ``is_shareable``.
    """
    node = db.get(Node, node_id)
    return _project_view(node) if node is not None else None


def container_of_node(db: Session, node_id: str) -> ProjectView | None:
    """Nearest container-role ``contains`` ancestor of any node (ADR-0049).

    ``project_of_task`` pins to the built-in ``project`` type, which is right for a task
    but too narrow for the notifier now that a rule can fire on any node: something
    created inside a user-defined container still needs a delivery scope. Returns None
    for a node with no container at all — the caller treats that as unscoped.
    """
    from .core import container_type_keys, parents_of

    keys = container_type_keys(db)
    queue: deque[str] = deque([node_id])
    seen: set[str] = {node_id}
    while queue:
        for parent in parents_of(db, queue.popleft()):
            if parent.type in keys:
                return _project_view(parent)
            if parent.id not in seen:
                seen.add(parent.id)
                queue.append(parent.id)
    return None


def find_project_by_share_token(db: Session, token: str) -> ProjectView | None:
    """Locate a project by its ``share_token`` (stored in ``data``).

    Scans project nodes and filters in Python: the token lives in the JSON ``data``
    bag (no indexed column) and project counts are small at personal-tool scale.
    """
    for node in db.query(Node).filter(Node.type == NODE_PROJECT).all():
        if (node.data or {}).get("share_token") == token:
            return _project_view(node)
    return None


def search_projects(db: Session, term: str, *, limit: int | None = None) -> list[ProjectView]:
    """Project nodes whose name (title) or description matches ``term`` (case-insensitive).

    ``name`` is the hot ``title`` column; ``description`` lives in JSON ``data`` and
    is matched in Python for dialect portability.
    """
    needle = term.lower()
    results: list[ProjectView] = []
    for node in db.query(Node).filter(Node.type == NODE_PROJECT).order_by(Node.created_at.desc()).all():
        title = (node.title or "").lower()
        description = ((node.data or {}).get("description") or "").lower()
        if needle in title or needle in description:
            results.append(_project_view(node))
            if limit is not None and len(results) >= limit:
                break
    return results


def contained_task_ids(db: Session, project_id: str) -> list[str]:
    """Ids of tasks contained by a project via outgoing ``contains`` edges."""
    tasks = task_type_keys(db)
    return [n.id for n in children_of(db, project_id) if n.type in tasks]


def child_container_ids(db: Session, container_id: str) -> list[str]:
    """Ids of the container-role nodes this node directly ``contains`` (ADR-0065).

    The other half of ``contained_task_ids``: a container's children split into
    tasks (its board) and containers (the level below it). Both are ``contains``
    edges — only the child's role tells them apart — so a nested container was
    previously invisible to every reader, which asked only for the task half.
    """
    containers = container_type_keys(db)
    return [n.id for n in children_of(db, container_id) if n.type in containers]


def unfiled_task_ids(db: Session) -> list[str]:
    """Ids of unfiled tasks: task-role nodes with no incoming ``contains`` edge (ADR-0032/0033).

    A task may legally belong to zero projects (the "unfiled" state is simply the
    absence of any project -> task ``contains`` edge). These have no container
    parent and no task parent — truly top-level tasks awaiting a home. Non-task
    node ids are filtered out by the caller when it loads ``Task`` rows.
    """
    filed = select(Edge.target_id).where(Edge.rel_type == REL_CONTAINS)
    rows = db.execute(select(Node.id).where(Node.type.in_(task_type_keys(db)), Node.id.notin_(filed))).scalars()
    return list(rows)
