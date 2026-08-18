"""External API v1 — graph-native node/edge write surface (ADR-0042).

Mirrors the internal ``/api/nodes`` surface for external consumers: create/read/
update/delete nodes of any registered type, attach/detach edges, and read a graph
slice. Writes delegate to the same role-driven dispatcher the internal surface and
the SPA use, so behaviour is identical; API-key ``scope`` and project-access checks
are layered on top (see ``auth._check_node_access`` / ``_check_create_access``).
"""

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
    "/graph/ancestry",
    summary="Where nodes live, and whose they are",
    description=(
        "For each requested node id: its `contains` trails (root-first, one per parent — a node "
        "may have several) and its `owns` owners. Batched: pass `ids` comma-separated. Ids that "
        "resolve to nothing, and ancestors a project-scoped key may not read, are omitted rather "
        "than refused. Requires `read` scope."
    ),
    response_model=dict[str, AncestryOut],
    responses=_auth_errors,
)
def api_graph_ancestry(
    ids: str = Query(description="comma-separated node ids"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node_ids = [i.strip() for i in ids.split(",") if i.strip()][: ancestry.MAX_IDS]
    return ancestry.ancestry_for(db, node_ids, visible=lambda n: _node_accessible(api_key, db, n))


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


@sub_router.get(
    "/nodes/{node_id}/subtree",
    summary="Get a container's rollup and the containers inside it",
    description=(
        "Returns this node's task rollup over its whole `contains` subtree plus its direct "
        "child containers, each with their own rollup. The companion to `contained-tasks`: "
        "that lists the node's own tasks, this lists the levels below it. Requires `read` scope."
    ),
    response_model=ContainerSubtree,
    responses={**_auth_errors, 404: {"description": "Node not found"}},
)
def api_node_subtree(
    node_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    # A project-scoped key must not learn the titles of containers outside its project,
    # so the child list is filtered by the same access rule the node reads use.
    return enrich_container_subtree(node, db, visible=lambda child: _node_accessible(api_key, db, child))


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
#
# Every rule here is `services/share_admin`'s, shared with `/api/nodes` (ADR-0087). This
# door was written fresh alongside the internal one and minted its own token from its own
# uuid4(); nothing had broken, which is the state ADR-0070 warns about — a duplicate that
# still works has no failure symptom, and ADR-0072 was the bill for the last one. What
# stays here is this door's own: the scope, and which nodes this key may touch.


class SetPinBody(BaseModel):
    pin: str


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


class SetGuestNotesBody(BaseModel):
    allowed: bool


def _load_shareable(node_id: str, db: Session, api_key: ApiKey) -> Node:
    node = share_admin.load(db, node_id)
    _check_node_access(api_key, db, node)
    return node


@sub_router.post(
    "/nodes/{node_id}/share/rotate-token",
    summary="Rotate a node's share token",
    description=(
        "Issues a new share token and returns it. The old link — and the calendar feed that "
        "reuses the same token — stop resolving immediately. Requires `admin` scope: the "
        "token *is* the public URL, so the response carries a capability, and the redaction "
        "middleware withholds it from a lesser key (ADR-0059)."
    ),
    responses=_auth_errors,
)
def api_rotate_share_token(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    # `write` until ADR-0087, which is how this was found: the middleware stripped
    # `share_token` from the response for any lesser key, so a `write` key rotated the
    # token — breaking the live link — and got back `200 {}`, with no way to learn the new
    # one. Same shape ADR-0084 refused to carve an exception for; meet the rule instead.
    _require_scope(api_key, "admin")
    _load_shareable(node_id, db, api_key)
    return share_admin.rotate_token(db, node_id)


@sub_router.post("/nodes/{node_id}/share/set-pin", summary="Set a node's share PIN", responses=_auth_errors)
def api_set_share_pin(
    node_id: str, body: SetPinBody, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    return share_admin.set_pin(db, node_id, body.pin)


@sub_router.delete("/nodes/{node_id}/share/pin", summary="Clear a node's share PIN", responses=_auth_errors)
def api_clear_share_pin(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    return share_admin.clear_pin(db, node_id)


@sub_router.post("/nodes/{node_id}/share/set-expiry", summary="Set a node's share expiry", responses=_auth_errors)
def api_set_share_expiry(
    node_id: str, body: SetExpiryBody, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    return share_admin.set_expiry(db, node_id, body.expires_at)


@sub_router.post(
    "/nodes/{node_id}/share/set-guest-notes",
    summary="Allow or stop guest notes on a node's share page",
    responses=_auth_errors,
)
def api_set_share_guest_notes(
    node_id: str, body: SetGuestNotesBody, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _load_shareable(node_id, db, api_key)
    return share_admin.set_guest_notes(db, node_id, body.allowed)


@sub_router.get(
    "/nodes/{node_id}/share-views",
    summary="How many times a node's share page has been viewed",
    responses=_auth_errors,
)
def api_get_share_views(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    _load_shareable(node_id, db, api_key)
    return share_admin.view_count(db, node_id)


@sub_router.get(
    "/nodes/{node_id}/share-chat-log",
    response_model=list[ShareChatLogOut],
    summary="What visitors asked the public read-only Q&A assistant on this node's share page",
    description=(
        "The question/answer pairs logged by `POST /share/node/{token}/chat` (ADR-0098). "
        "Never the `ip_hash` column — that exists only for the rate limiter, not for "
        "display. Requires `read` scope, same as `share-views`: this describes what "
        "happened on the public page, it does not hand out a credential."
    ),
    responses=_auth_errors,
)
def api_get_share_chat_log(
    node_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _load_shareable(node_id, db, api_key)
    return share_admin.chat_log(db, node_id, limit=limit, offset=offset)


# ── Inbound CI/CD callback credentials (ADR-0084) ─────────────────
#
# The same act as GET /api/nodes/{id}/webhook, through the door an agent can reach. It
# was internal-only, which in production means behind AUTH_PASSWORD, which means CI could
# only be configured by a person in a browser — while /api/v1/subscriptions had already
# accepted that an agent registers its own outbound callbacks.
#
# ``admin``, not ``write``, and that is not caution: the redaction middleware strips
# ``callback_token`` from every v1 response for a lesser key (ADR-0059), so a ``write``
# key would receive a config with the address missing and no way to tell. The rule is
# response-shaped on purpose — a new endpoint must not be able to be written without it —
# so the right move is to meet it rather than carve an exception into it. Handing out a
# token plus its signing key mints an unauthenticated write path into the system; that is
# an administrative act, not an ordinary one.


def _load_webhookable(node_id: str, db: Session, api_key: ApiKey) -> Node:
    node = _load_node_or_404(node_id, db)
    _check_node_access(api_key, db, node)
    # The type rule is the service's, and so is its refusal — one handler renders it for
    # both doors, so they cannot answer it differently (ADR-0085).
    webhook_credentials.ensure_webhookable(db, node)
    return node


@sub_router.get(
    "/nodes/{node_id}/webhook",
    response_model=WebhookConfigOut,
    summary="Reveal a node's inbound CI/CD callback credentials",
    description=(
        "Returns the `callback_token` and signing `secret` a CI provider needs to post "
        "build results to `POST /webhook/callback/{callback_token}`, plus the `path` to "
        "post to. Credentials are minted on first request for nodes that lack them. "
        "Callbacks are signed with HMAC-SHA256 over the raw body and rejected without a "
        "valid `X-Hub-Signature-256` (ADR-0060). Requires `admin` scope; the reveal is "
        "recorded in the activity log."
    ),
    responses=_auth_errors,
)
def api_get_node_webhook_config(node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    node = _load_webhookable(node_id, db, api_key)
    config = webhook_credentials.reveal(db, node, actor=_build_actor(api_key))
    db.commit()
    return config


@sub_router.post(
    "/nodes/{node_id}/webhook/rotate-secret",
    response_model=WebhookConfigOut,
    summary="Rotate a node's inbound CI/CD signing secret",
    description=(
        "Issues a new signing secret and returns the full config. Callbacks signed with "
        "the old secret stop being accepted immediately, so update the CI provider in the "
        "same change. The `callback_token` is unaffected. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_rotate_node_webhook_secret(
    node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "admin")
    node = _load_webhookable(node_id, db, api_key)
    config = webhook_credentials.rotate(db, node, actor=_build_actor(api_key))
    db.commit()
    return config


@sub_router.post(
    "/nodes/{node_id}/webhook/rotate-token",
    response_model=WebhookConfigOut,
    summary="Rotate a node's inbound CI/CD callback address",
    description=(
        "Issues a new `callback_token`, which is the callback *address*. The old URL stops "
        "resolving immediately. Use this when the URL itself has leaked — it ends up in "
        "pipeline config, proxy logs and screenshots — and `rotate-secret` when only the "
        "signing key has. Returns the full config. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_rotate_node_callback_token(
    node_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "admin")
    node = _load_webhookable(node_id, db, api_key)
    config = webhook_credentials.rotate_token(db, node, actor=_build_actor(api_key))
    db.commit()
    return config


@sub_router.get(
    "/nodes/{node_id}/webhook-events",
    response_model=list[WebhookEventOut],
    summary="Build history for a node",
    description=(
        "Inbound CI/CD callbacks recorded against this node, newest first — provider, "
        "status, commit, branch, build URL and the raw payload. A row is written for every "
        "callback that arrives, including ones whose status this system could not map "
        '(`status: "unmapped"`, ADR-0051). Requires `read` scope.'
    ),
    responses=_auth_errors,
)
def api_get_node_webhook_events(
    node_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    node = _load_webhookable(node_id, db, api_key)
    return webhook_credentials.build_history(db, node, limit=limit, offset=offset)
