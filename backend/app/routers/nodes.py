"""Generic graph node/edge API (ADR-0033).

Create, read, update, and delete nodes of any registered type, and
attach/detach edges between any two nodes. Since Phase C every built-in type
(task/project/identity/goal/cycle/label) is node-only — there is no separate
entity table to keep in sync — so this API accepts them too; the dedicated
routers remain the richer surface (enrichment, activity, notifications).
Free-form containment is the point: a custom node may contain a project/task via
a ``contains`` edge; only ``detect_cycle`` guards the structure.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Edge, EdgeType, GraphEvent, Node, NodeType
from app.schemas import (
    AncestryOut,
    ContainerSubtree,
    EdgeCreate,
    EdgeOut,
    GraphEventOut,
    NodeCreate,
    NodeOut,
    NodeUpdate,
    ShareChatLogOut,
    TaskOut,
    WebhookEventOut,
)
from app.services import ancestry, graph, node_data, share_admin, webhook_credentials
from app.services.enrichment import enrich_container_subtree, enrich_task
from app.services.graph_dispatch import (
    dispatch_edge_added,
    dispatch_edge_removed,
    dispatch_node_created,
    dispatch_node_deleted,
    dispatch_node_updated,
)
from app.services.task_mutations import AgentKeyError
from app.services.webhook_credentials import WebhookConfigOut

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
                # This endpoint assembles its payload by hand, so it never passed through
                # ``NodeOut`` and never inherited the credential redaction every other
                # node read gets (ADR-0059) — it was still handing out PIN hashes and
                # signing secrets. Tokens stay: this is the owner's own session.
                **({"data": node_data.public_data(n.data)} if with_data else {}),
            }
            for n in nodes
        ],
        "edges": [
            {"id": e.id, "source_id": e.source_id, "target_id": e.target_id, "rel_type": e.rel_type} for e in edges
        ],
    }


@graph_router.get("/ancestry", response_model=dict[str, AncestryOut])
def graph_ancestry(
    ids: str = Query(description="comma-separated node ids"),
    db: Session = Depends(get_db),
):
    """Where each of these nodes lives, and whose it is (ADR-0094).

    Batched because the callers are lists: the dashboard asks about every project it
    is about to draw. Ids that resolve to nothing are absent from the map rather than
    a 404 — one deleted member must not cost the whole answer.
    """
    node_ids = [i.strip() for i in ids.split(",") if i.strip()][: ancestry.MAX_IDS]
    return ancestry.ancestry_for(db, node_ids)


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


def _node_write_out(db: Session, node: Node):
    """Serialize a written node: enriched ``TaskOut`` for task-role nodes, else ``NodeOut``.

    ADR-0040: the generic write surface returns the same rich shape the retired
    ``/projects/{id}/tasks`` routes did, so callers get ``project_id`` / subtask &
    comment counts / dependency lists without a second request.
    """
    if node.type in graph.task_type_keys(db):
        return enrich_task(graph.get_task(db, node.id), db)
    return NodeOut.model_validate(node)


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: Session = Depends(get_db)):
    if db.get(NodeType, body.type) is None:
        raise HTTPException(status_code=422, detail=f"unknown node type '{body.type}'")
    container_id, parent_id = body.container_id, body.parent_id
    # Validate containment hints before creating anything (a bogus id must not mint a
    # phantom node / dangling edge). Mirrors the retired task route's 404 contract.
    if container_id is not None and db.get(Node, container_id) is None:
        raise HTTPException(status_code=404, detail="Container not found")
    if parent_id is not None:
        parent = graph.get_task(db, parent_id)
        in_scope = container_id is None or parent_id in graph.contained_task_ids(db, container_id)
        if parent is None or not in_scope:
            raise HTTPException(status_code=404, detail="Parent task not found")
    fields = body.model_dump(exclude={"type", "title", "data", "container_id", "parent_id"}, exclude_none=True)
    if body.data:
        fields.update(body.data)
    node = graph.create_node(db, body.type, title=body.title, **fields)
    # Establish containment before dispatch so the task pipeline can resolve the
    # node's project (nearest container ancestor) for activity/notifications. A
    # subtask gets both a container and a parent ``contains`` edge (ADR-0032).
    for edge_source in (container_id, parent_id):
        if edge_source is not None:
            graph.add_edge(db, edge_source, node.id, graph.REL_CONTAINS)
    # Role-driven reactions live below the endpoint now (ADR-0040): a task written
    # here runs the same pipeline as one written via the retired /projects/{id}/tasks.
    await dispatch_node_created(db, node)
    db.refresh(node)
    return _node_write_out(db, node)


@router.get("/{node_id}", response_model=NodeOut)
def get_node(node_id: str, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    return node


@router.patch("/{node_id}", response_model=None)
async def update_node(node_id: str, body: NodeUpdate, db: Session = Depends(get_db)):
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    fields = body.model_dump(exclude_unset=True)
    data = fields.pop("data", None)
    if data is not None:
        fields.update(data)
    # Re-parenting is a graph move, not a column write (ADR-0032/0040): the new parent
    # must be a task in the same project (404) and must not close a cycle (400).
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
        node = await dispatch_node_updated(db, node, fields)
    except AgentKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.refresh(node)
    return _node_write_out(db, node)


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


@router.get("/{node_id}/subtree", response_model=ContainerSubtree)
def get_node_subtree(node_id: str, db: Session = Depends(get_db)):
    """This container's rollup plus its direct child containers, each rolled up (ADR-0065).

    The companion to ``contained-tasks``: that endpoint answers "what sits on this
    node's board", this one answers "what sits below it". Together they account for
    every ``contains`` child, which is why the level a user inserts stops vanishing.
    The rollup rule lives here, server-side, so no client re-derives it.
    """
    node = db.get(Node, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    return enrich_container_subtree(node, db)


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
async def attach_edge(node_id: str, body: EdgeCreate, db: Session = Depends(get_db)):
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
    # Dispatch, not a bare commit: an edge written here must have the same
    # consequences as the same edge written through a named sub-resource (ADR-0045).
    await dispatch_edge_added(db, node_id, body.target_id, body.rel_type)
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
async def detach_edge(
    node_id: str,
    target_id: str = Query(...),
    rel_type: str = Query(...),
    db: Session = Depends(get_db),
):
    removed = graph.remove_edge(db, node_id, target_id, rel_type)
    if not removed:
        raise HTTPException(status_code=404, detail="edge not found")
    await dispatch_edge_removed(db, node_id, target_id, rel_type)


# ── Share facade management (ADR-0039) ───────────────────────────────────────
# Every write a share panel makes, for any is_shareable node: token, PIN, expiry,
# guest notes, plus the view count it reads back. Identity and project both route
# here — their own routers keep only the enriched entity reads — so the share panel
# has one implementation instead of one per entity type (ADR-0070).


class SetPinBody(BaseModel):
    pin: str


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


class SetGuestNotesBody(BaseModel):
    allowed: bool


@router.post("/{node_id}/share/rotate-token")
def rotate_node_share_token(node_id: str, db: Session = Depends(get_db)):
    return share_admin.rotate_token(db, share_admin.load(db, node_id).id)


@router.post("/{node_id}/share/set-pin")
def set_node_share_pin(node_id: str, body: SetPinBody, db: Session = Depends(get_db)):
    return share_admin.set_pin(db, share_admin.load(db, node_id).id, body.pin)


@router.delete("/{node_id}/share/pin")
def clear_node_share_pin(node_id: str, db: Session = Depends(get_db)):
    return share_admin.clear_pin(db, share_admin.load(db, node_id).id)


@router.post("/{node_id}/share/set-expiry")
def set_node_share_expiry(node_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    return share_admin.set_expiry(db, share_admin.load(db, node_id).id, body.expires_at)


@router.post("/{node_id}/share/set-guest-notes")
def set_node_guest_notes(node_id: str, body: SetGuestNotesBody, db: Session = Depends(get_db)):
    """Let (or stop letting) visitors leave notes on this node's share page (ADR-0016)."""
    return share_admin.set_guest_notes(db, share_admin.load(db, node_id).id, body.allowed)


@router.get("/{node_id}/share-views")
def get_node_share_views(node_id: str, db: Session = Depends(get_db)):
    return share_admin.view_count(db, share_admin.load(db, node_id).id)


# --- Inbound webhook credentials (ADR-0060, generalized to containers by ADR-0082) --
# The signing secret is never served in a node or task payload (ADR-0059) and the
# callback now refuses unsigned requests, so there has to be one deliberate place to
# read it — otherwise the credential exists and nobody can configure CI with it.
# It sits here rather than under /projects/{id}/tasks because a task-like custom type
# is a first-class task (ADR-0035) and need not live under a literal project.
#
# A container-role node (a project) can hold the same credentials: it has no build
# outcome to apply, but push/CI events are worth logging against it (ADR-0082). Unlike
# a task, a container is never minted with these at creation — every write path that
# creates one would need touching — so they are provisioned lazily on first reveal.
#
# The act itself lives in services/webhook_credentials.py, because /api/v1 performs the
# same one (ADR-0084). What stays here is what is this door's own: no scope to check,
# because reaching /api at all means the session passed the password gate. The 404/400
# refusals are the service's and are rendered by one handler (ADR-0085).


@router.get("/{node_id}/webhook", response_model=WebhookConfigOut)
def get_node_webhook_config(node_id: str, db: Session = Depends(get_db)):
    """Reveal the callback credentials for one node, as a deliberate act."""
    config = webhook_credentials.reveal(db, webhook_credentials.load(db, node_id), actor="user")
    db.commit()
    return config


@router.post("/{node_id}/webhook/rotate-secret", response_model=WebhookConfigOut)
def rotate_node_webhook_secret(node_id: str, db: Session = Depends(get_db)):
    """Issue a new signing key. Callbacks signed with the old one stop being accepted."""
    config = webhook_credentials.rotate(db, webhook_credentials.load(db, node_id), actor="user")
    db.commit()
    return config


@router.post("/{node_id}/webhook/rotate-token", response_model=WebhookConfigOut)
def rotate_node_callback_token(node_id: str, db: Session = Depends(get_db)):
    """Issue a new callback address. The old URL stops resolving (ADR-0085)."""
    config = webhook_credentials.rotate_token(db, webhook_credentials.load(db, node_id), actor="user")
    db.commit()
    return config


@router.get("/{node_id}/webhook-events", response_model=list[WebhookEventOut])
def get_node_webhook_events(
    node_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Build history for a node. Moved here from ``GET /webhook/events/{id}``, which sat
    under the auth-bypassed ``/webhook/`` prefix and was readable by anybody (ADR-0085)."""
    return webhook_credentials.build_history(db, webhook_credentials.load(db, node_id), limit=limit, offset=offset)


@router.get("/{node_id}/share-chat-log", response_model=list[ShareChatLogOut])
def get_node_share_chat_log(
    node_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """What visitors asked the public read-only Q&A assistant on this node's share page
    (ADR-0098, ADR-0099). Never the ``ip_hash`` column — that exists only for the rate
    limiter and abuse bookkeeping, not for display."""
    return share_admin.chat_log(db, node_id, limit=limit, offset=offset)
