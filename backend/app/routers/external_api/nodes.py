"""External API v1 — graph-native node/edge write surface (ADR-0042).

Mirrors the internal ``/api/nodes`` surface for external consumers: create/read/
update/delete nodes of any registered type, attach/detach edges, and read a graph
slice. Writes delegate to the same role-driven dispatcher the internal surface and
the SPA use, so behaviour is identical; API-key ``scope`` and project-access checks
are layered on top (see ``auth._check_node_access`` / ``_check_create_access``).
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import ApiKey, Edge, EdgeType, GraphEvent, Node, NodeType
from app.routers.external_api.auth import (
    _auth_errors,
    _build_actor,
    _check_create_access,
    _check_node_access,
    _get_api_key,
    _node_accessible,
    _require_scope,
)
from app.schemas import EdgeCreate, EdgeOut, GraphEventOut, NodeCreate, NodeOut, NodeUpdate, TaskOut
from app.services import graph, node_data
from app.services.enrichment import enrich_task
from app.services.graph_dispatch import (
    dispatch_edge_added,
    dispatch_edge_removed,
    dispatch_node_created,
    dispatch_node_deleted,
    dispatch_node_updated,
)
from app.services.task_mutations import AgentKeyError

sub_router = APIRouter()


def _load_node_or_404(node_id: str, db: Session) -> Node:
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    return node


def _node_write_out(db: Session, node: Node):
    """Enriched ``TaskOut`` for task-role nodes, else ``NodeOut`` (parity with internal)."""
    if node.type in graph.task_type_keys(db):
        return enrich_task(graph.get_task(db, node.id), db)
    return NodeOut.model_validate(node)


@sub_router.get(
    "/graph/map",
    summary="Graph slice (nodes + edges)",
    description="One-shot `{nodes, edges}` view of the graph. A project-scoped key sees only "
    "nodes governed by its project. Requires `read` scope.",
    responses=_auth_errors,
)
def api_graph_map(
    types: str | None = Query(default=None, description="comma-separated node type keys to include"),
    include: str | None = Query(default=None, description="'data' to include each node's data payload"),
    limit: int = Query(default=2000, le=5000),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    q = db.query(Node)
    if types:
        keys = [k.strip() for k in types.split(",") if k.strip()]
        q = q.filter(Node.type.in_(keys))
    nodes = [n for n in q.order_by(Node.created_at).limit(limit).all() if _node_accessible(api_key, db, n)]
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
    # Only the unconditional half here; the token half is applied to the whole v1 response
    # by the redaction middleware, which knows the caller's scopes (ADR-0059).
    reveal = True
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
                **({"data": node_data.public_data(n.data, reveal_tokens=reveal)} if with_data else {}),
            }
            for n in nodes
        ],
        "edges": [
            {"id": e.id, "source_id": e.source_id, "target_id": e.target_id, "rel_type": e.rel_type} for e in edges
        ],
    }


@sub_router.get(
    "/nodes",
    summary="List nodes",
    description="Lists nodes, optionally filtered by type and title substring. A project-scoped key "
    "sees only nodes governed by its project. Requires `read` scope.",
    response_model=list[NodeOut],
    responses=_auth_errors,
)
def api_list_nodes(
    type: str | None = Query(default=None),
    query: str | None = Query(default=None, description="case-insensitive title substring filter"),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    q = db.query(Node)
    if type is not None:
        q = q.filter(Node.type == type)
    if query:
        q = q.filter(Node.title.ilike(f"%{query}%"))
    rows = q.order_by(Node.position, Node.created_at).limit(limit).all()
    return [n for n in rows if _node_accessible(api_key, db, n)]


@sub_router.post(
    "/nodes",
    status_code=status.HTTP_201_CREATED,
    summary="Create a node",
    description="Creates a node of any registered type. `container_id`/`parent_id` file it under a "
    "container/parent as `contains` edges. Task-role nodes return an enriched task. A project-scoped "
    "key must file the node into its own project (cannot create top-level project/goal/identity). "
    "Requires `write` scope.",
    response_model=None,
    responses={**_auth_errors, 404: {"description": "Container or parent not found"}, 422: {}},
)
async def api_create_node(
    body: NodeCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    if db.get(NodeType, body.type) is None:
        raise HTTPException(status_code=422, detail=f"unknown node type '{body.type}'")
    container_id, parent_id = body.container_id, body.parent_id
    if container_id is not None and db.get(Node, container_id) is None:
        raise HTTPException(status_code=404, detail="Container not found")
    if parent_id is not None:
        parent = graph.get_task(db, parent_id)
        in_scope = container_id is None or parent_id in graph.contained_task_ids(db, container_id)
        if parent is None or not in_scope:
            raise HTTPException(status_code=404, detail="Parent task not found")
    _check_create_access(api_key, db, container_id, parent_id)
    fields = body.model_dump(exclude={"type", "title", "data", "container_id", "parent_id"}, exclude_none=True)
    if body.data:
        fields.update(body.data)
    node = graph.create_node(db, body.type, title=body.title, **fields)
    for edge_source in (container_id, parent_id):
        if edge_source is not None:
            graph.add_edge(db, edge_source, node.id, graph.REL_CONTAINS)
    await dispatch_node_created(db, node, actor=_build_actor(api_key, x_agent_id), source="api")
    db.refresh(node)
    return _node_write_out(db, node)


@sub_router.get(
    "/nodes/{node_id}",
    summary="Get a node",
    response_model=NodeOut,
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
def api_get_node(
    node_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    return node


@sub_router.patch(
    "/nodes/{node_id}",
    summary="Update a node",
    description="Partially updates a node. Task-role nodes fire the status/priority reactions and "
    "return an enriched task. Requires `write` scope.",
    response_model=None,
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
async def api_update_node(
    node_id: str,
    body: NodeUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    fields = body.model_dump(exclude_unset=True)
    data = fields.pop("data", None)
    if data is not None:
        fields.update(data)
    new_parent_id = fields.pop("parent_id", None)
    if new_parent_id is not None and node.type in graph.task_type_keys(db):
        project_id = graph.project_id_of_task(db, node_id)
        parent = graph.get_task(db, new_parent_id)
        if parent is None or (project_id and new_parent_id not in graph.contained_task_ids(db, project_id)):
            raise HTTPException(status_code=404, detail="Parent task not found")
        try:
            graph.set_parent_task(db, node_id, new_parent_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        node = await dispatch_node_updated(db, node, fields, actor=_build_actor(api_key, x_agent_id), source="api")
    except AgentKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(node)
    return _node_write_out(db, node)


@sub_router.delete(
    "/nodes/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a node",
    description="Deletes a node. Task-role nodes tear down their subtree; container-role nodes cascade "
    "their exclusively-owned tasks and scoped labels/cycles (ADR-0043); other types drop the node and "
    "its edges. Deleting a container requires `admin`, anything else `write`.",
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
async def api_delete_node(
    node_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    node = _load_node_or_404(node_id, db)
    # Deleting a whole container (project/goal/custom container) is destructive — keep the
    # old v1 contract that it needs `admin`; deleting a task needs `write` (ADR-0042).
    _require_scope(api_key, "admin" if node.type in graph.container_type_keys(db) else "write")
    _check_node_access(api_key, db, node)
    await dispatch_node_deleted(db, node, actor=_build_actor(api_key, x_agent_id), source="api")


@sub_router.get(
    "/nodes/{node_id}/contained-tasks",
    summary="List tasks contained by a node",
    response_model=list[TaskOut],
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
def api_contained_tasks(
    node_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    views = graph.tasks_in_project(db, node_id)
    views.sort(key=lambda v: (v.position, v.created_at))
    return [enrich_task(v, db) for v in views]


# ── Edges ─────────────────────────────────────────────────────────


@sub_router.get(
    "/nodes/{node_id}/edges",
    summary="List a node's edges",
    response_model=list[EdgeOut],
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
def api_list_edges(
    node_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    return (
        db.query(Edge)
        .options(selectinload(Edge.source), selectinload(Edge.target))
        .filter((Edge.source_id == node_id) | (Edge.target_id == node_id))
        .order_by(Edge.rel_type, Edge.position, Edge.created_at)
        .all()
    )


@sub_router.post(
    "/nodes/{node_id}/edges",
    status_code=status.HTTP_201_CREATED,
    summary="Attach an edge",
    description="Creates an edge from this node to a target. A project-scoped key must have access to "
    "both endpoints. Requires `write` scope.",
    response_model=EdgeOut,
    responses={**_auth_errors, 404: {"description": "Node not found"}, 422: {}},
)
async def api_attach_edge(
    node_id: str,
    body: EdgeCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    source = _load_node_or_404(node_id, db)
    target = db.get(Node, body.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="target node not found")
    if db.get(EdgeType, body.rel_type) is None:
        raise HTTPException(status_code=422, detail=f"unknown edge type '{body.rel_type}'")
    _check_node_access(api_key, db, source)
    _check_node_access(api_key, db, target)
    try:
        edge = graph.add_edge(db, node_id, body.target_id, body.rel_type, position=body.position, data=body.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await dispatch_edge_added(db, node_id, body.target_id, body.rel_type, actor=f"api:{api_key.name}")
    db.refresh(edge)
    return edge


@sub_router.delete(
    "/nodes/{node_id}/edges",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Detach an edge",
    responses={**_auth_errors, 404: {"description": "Edge not found"}},
)
async def api_detach_edge(
    node_id: str,
    target_id: str = Query(...),
    rel_type: str = Query(...),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    source = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, source)
    if not graph.remove_edge(db, node_id, target_id, rel_type):
        raise HTTPException(status_code=404, detail="edge not found")
    await dispatch_edge_removed(db, node_id, target_id, rel_type, actor=f"api:{api_key.name}")


@sub_router.get(
    "/nodes/{node_id}/events",
    summary="Node provenance (audit trail)",
    response_model=list[GraphEventOut],
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
def api_node_events(
    node_id: str,
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    return (
        db.query(GraphEvent)
        .filter((GraphEvent.node_id == node_id) | (GraphEvent.source_id == node_id) | (GraphEvent.target_id == node_id))
        .order_by(GraphEvent.created_at.desc())
        .limit(limit)
        .all()
    )


# ── Share facade (shareable-role nodes) ───────────────────────────


class SetPinBody(BaseModel):
    pin: str


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


def _load_shareable(node_id: str, db: Session, api_key: ApiKey) -> Node:
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    if not graph.node_is_shareable(db, node):
        raise HTTPException(status_code=400, detail="node type is not shareable")
    return node


@sub_router.post("/nodes/{node_id}/share/rotate-token", summary="Rotate a node's share token", responses=_auth_errors)
def api_rotate_share_token(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    token = str(uuid.uuid4())
    graph.update_node(db, node_id, share_token=token)
    db.commit()
    return {"share_token": token}


@sub_router.post("/nodes/{node_id}/share/set-pin", summary="Set a node's share PIN", responses=_auth_errors)
def api_set_share_pin(
    node_id: str, body: SetPinBody, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    from app.services.pin_utils import hash_pin

    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    if not body.pin or len(body.pin) < 4 or len(body.pin) > 6 or not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")
    graph.update_node(db, node_id, share_pin_hash=hash_pin(body.pin))
    db.commit()
    return {"ok": True}


@sub_router.delete("/nodes/{node_id}/share/pin", summary="Clear a node's share PIN", responses=_auth_errors)
def api_clear_share_pin(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    graph.update_node(db, node_id, share_pin_hash=None)
    db.commit()
    return {"ok": True}


@sub_router.post("/nodes/{node_id}/share/set-expiry", summary="Set a node's share expiry", responses=_auth_errors)
def api_set_share_expiry(
    node_id: str, body: SetExpiryBody, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    graph.update_node(db, node_id, share_expires_at=body.expires_at.isoformat() if body.expires_at else None)
    db.commit()
    return {"ok": True}
