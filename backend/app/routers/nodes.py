"""Generic graph node/edge API (ADR-0033).

Create, read, update, and delete nodes of any registered type, and
attach/detach edges between any two nodes. Since Phase C every built-in type
(task/project/identity/goal/cycle/label) is node-only — there is no separate
entity table to keep in sync — so this API accepts them too; the dedicated
routers remain the richer surface (enrichment, activity, notifications).
Free-form containment is the point: a custom node may contain a project/task via
a ``contains`` edge; only ``detect_cycle`` guards the structure.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Edge, EdgeType, GraphEvent, Node, NodeType
from app.schemas import EdgeCreate, EdgeOut, GraphEventOut, NodeCreate, NodeOut, NodeUpdate, TaskOut
from app.services import graph
from app.services.enrichment import enrich_task
from app.services.graph_dispatch import dispatch_node_created, dispatch_node_deleted, dispatch_node_updated
from app.services.task_mutations import AgentKeyError

router = APIRouter(prefix="/nodes", tags=["nodes"])

# Whole-graph slice for map/visualization clients (ADR-0037). Separate prefix so
# it reads as "the graph", not "a node".
graph_router = APIRouter(prefix="/graph", tags=["nodes"])


@graph_router.get("/map")
def graph_map(
    types: str | None = Query(default=None, description="comma-separated node type keys to include"),
    include: str | None = Query(default=None, description="'data' to include each node's data payload"),
    limit: int = Query(default=2000, le=5000),
    db: Session = Depends(get_db),
):
    """One-shot ``{nodes, edges}`` slice of the graph (ADR-0037).

    Nodes carry hot columns by default; pass ``include=data`` for the full
    payload (needed by clients that derive enrichment — e.g. the structure map
    computes progress/risk/decision status from it). Edges are those with both
    endpoints in the returned node set, ordered by ``(position, created_at)`` so
    "first container" picks are deterministic and match compat ``project_id``.
    """
    q = db.query(Node)
    if types:
        keys = [k.strip() for k in types.split(",") if k.strip()]
        q = q.filter(Node.type.in_(keys))
    nodes = q.order_by(Node.created_at).limit(limit).all()
    ids = {n.id for n in nodes}
    edges = (
        db.query(Edge)
        .filter(Edge.source_id.in_(ids), Edge.target_id.in_(ids))
        .order_by(Edge.position, Edge.created_at)
        .all()
        if ids
        else []
    )
    with_data = include == "data"
    return {
        "nodes": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "status": n.status,
                "priority": n.priority,
                "due_date": n.due_date,
                "is_pinned": n.is_pinned,
                **({"data": n.data} if with_data else {}),
            }
            for n in nodes
        ],
        "edges": [
            {"id": e.id, "source_id": e.source_id, "target_id": e.target_id, "rel_type": e.rel_type} for e in edges
        ],
    }


@router.get("", response_model=list[NodeOut])
def list_nodes(
    type: str | None = Query(default=None),
    query: str | None = Query(default=None, description="case-insensitive title substring filter"),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Node)
    if type is not None:
        q = q.filter(Node.type == type)
    if query:
        q = q.filter(Node.title.ilike(f"%{query}%"))
    return q.order_by(Node.position, Node.created_at).limit(limit).all()


@router.post("", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: Session = Depends(get_db)):
    if db.get(NodeType, body.type) is None:
        raise HTTPException(status_code=422, detail=f"unknown node type '{body.type}'")
    fields = body.model_dump(exclude={"type", "title", "data"}, exclude_none=True)
    if body.data:
        fields.update(body.data)
    node = graph.create_node(db, body.type, title=body.title, **fields)
    # Role-driven reactions live below the endpoint now (ADR-0040): a task written
    # here runs the same pipeline as one written via /projects/{id}/tasks.
    await dispatch_node_created(db, node)
    db.refresh(node)
    return node


@router.get("/{node_id}", response_model=NodeOut)
def get_node(node_id: str, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    return node


@router.patch("/{node_id}", response_model=NodeOut)
async def update_node(node_id: str, body: NodeUpdate, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    fields = body.model_dump(exclude_unset=True)
    data = fields.pop("data", None)
    if data is not None:
        fields.update(data)
    try:
        node = await dispatch_node_updated(db, node, fields)
    except AgentKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    await dispatch_node_deleted(db, node)


@router.get("/{node_id}/contained-tasks", response_model=list[TaskOut])
def list_contained_tasks(node_id: str, db: Session = Depends(get_db)):
    """Enriched tasks contained by this node via ``contains`` edges (ADR-0037).

    The container view for user-defined container types: any node works (the
    helper simply follows outgoing containment to task-role children), so custom
    containers get the same task listing shape as projects.
    """
    if db.get(Node, node_id) is None:
        raise HTTPException(status_code=404, detail="node not found")
    views = graph.tasks_in_project(db, node_id)
    views.sort(key=lambda v: (v.position, v.created_at))
    return [enrich_task(v, db) for v in views]


# --- Edges -------------------------------------------------------------------


@router.get("/{node_id}/edges", response_model=list[EdgeOut])
def list_node_edges(node_id: str, db: Session = Depends(get_db)):
    if db.get(Node, node_id) is None:
        raise HTTPException(status_code=404, detail="node not found")
    return (
        db.query(Edge)
        .options(selectinload(Edge.source), selectinload(Edge.target))
        .filter((Edge.source_id == node_id) | (Edge.target_id == node_id))
        .order_by(Edge.rel_type, Edge.position, Edge.created_at)
        .all()
    )


@router.post("/{node_id}/edges", response_model=EdgeOut, status_code=status.HTTP_201_CREATED)
def attach_edge(node_id: str, body: EdgeCreate, db: Session = Depends(get_db)):
    if db.get(Node, node_id) is None:
        raise HTTPException(status_code=404, detail="source node not found")
    if db.get(Node, body.target_id) is None:
        raise HTTPException(status_code=404, detail="target node not found")
    if db.get(EdgeType, body.rel_type) is None:
        raise HTTPException(status_code=422, detail=f"unknown edge type '{body.rel_type}'")
    try:
        edge = graph.add_edge(db, node_id, body.target_id, body.rel_type, position=body.position, data=body.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(edge)
    return edge


@router.get("/{node_id}/events", response_model=list[GraphEventOut])
def list_node_events(node_id: str, limit: int = Query(default=100, le=500), db: Session = Depends(get_db)):
    """Provenance (audit trail) for a node: every event touching it, newest first."""
    return (
        db.query(GraphEvent)
        .filter((GraphEvent.node_id == node_id) | (GraphEvent.source_id == node_id) | (GraphEvent.target_id == node_id))
        .order_by(GraphEvent.created_at.desc())
        .limit(limit)
        .all()
    )


@router.delete("/{node_id}/edges", status_code=status.HTTP_204_NO_CONTENT)
def detach_edge(
    node_id: str,
    target_id: str = Query(...),
    rel_type: str = Query(...),
    db: Session = Depends(get_db),
):
    removed = graph.remove_edge(db, node_id, target_id, rel_type)
    if not removed:
        raise HTTPException(status_code=404, detail="edge not found")
    db.commit()


# ── Share facade management (ADR-0039) ───────────────────────────────────────
# Generic share-token/PIN/expiry operations for any is_shareable node. Identity
# keeps its own /identities/{id}/... endpoints (behaviourally identical); these
# make the same facade available to user-defined shareable types (e.g. topic).


def _load_shareable_node(node_id: str, db: Session) -> Node:
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    if not graph.node_is_shareable(db, node):
        raise HTTPException(status_code=400, detail="node type is not shareable")
    return node


class SetPinBody(BaseModel):
    pin: str


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


@router.post("/{node_id}/share/rotate-token")
def rotate_node_share_token(node_id: str, db: Session = Depends(get_db)):
    _load_shareable_node(node_id, db)
    token = str(uuid.uuid4())
    graph.update_node(db, node_id, share_token=token)
    db.commit()
    return {"share_token": token}


@router.post("/{node_id}/share/set-pin")
def set_node_share_pin(node_id: str, body: SetPinBody, db: Session = Depends(get_db)):
    from app.services.pin_utils import hash_pin

    _load_shareable_node(node_id, db)
    if not body.pin or len(body.pin) < 4 or len(body.pin) > 6 or not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")
    graph.update_node(db, node_id, share_pin_hash=hash_pin(body.pin))
    db.commit()
    return {"ok": True}


@router.delete("/{node_id}/share/pin")
def clear_node_share_pin(node_id: str, db: Session = Depends(get_db)):
    _load_shareable_node(node_id, db)
    graph.update_node(db, node_id, share_pin_hash=None)
    db.commit()
    return {"ok": True}


@router.post("/{node_id}/share/set-expiry")
def set_node_share_expiry(node_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    _load_shareable_node(node_id, db)
    # Stored as an ISO string in node.data (update_node does not encode datetimes).
    graph.update_node(db, node_id, share_expires_at=body.expires_at.isoformat() if body.expires_at else None)
    db.commit()
    return {"ok": True}
