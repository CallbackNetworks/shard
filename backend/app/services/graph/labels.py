"""Labels (node-only, ADR-0033 Phase B).

A label is a ``Node(type="label")`` whose ``title`` holds the name and whose
``data`` bag holds ``color``/``type``/``description``/``decision_status``/
``source``. Its project scope is a ``contains`` edge (project -> label). The
``LabelView`` adapter exposes the historical ``Label`` attribute surface so
``LabelOut.model_validate`` and existing read sites keep working unchanged.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.graph.core import (
    NODE_LABEL,
    NODE_TASK,
    REL_CONTAINS,
    REL_LABELED,
    add_edge,
    create_node,
    delete_node,
    ensure_node,
    project_container_map,
    remove_edge,
)


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
