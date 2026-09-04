"""
External API v1 — the relation vocabulary (ADR-0078).

An agent could always write edges (`POST /api/v1/nodes/{id}/edges`) but had no way
to read what the relations mean or what may sit at their ends: the internal registry
was never exposed under `/api/v1`, so picking the wrong one was a guess whose only
feedback was a silently useless edge.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import EdgeTypeCreate, EdgeTypeOut, EdgeTypeUpdate, RelationOptionOut
from app.services import graph_registry as type_registry
from app.services.graph_registry import relation_vocabulary

sub_router = APIRouter()


def _registry(call):
    """Run a registry operation, reporting its refusal as HTTP — the same translation the
    internal door does, so both answer a refusal identically (ADR-0079)."""
    try:
        return call()
    except type_registry.TypeRegistryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@sub_router.get(
    "/edge-types",
    summary="Relation vocabulary",
    description="""Every relation (edge type) with its meaning and the node types/roles
allowed at each end. `allowed_source`/`allowed_target` are `{types, roles}` allow-lists —
a node qualifies by matching either, and a null rule means unconstrained. These are
enforced on write: an edge whose endpoints do not satisfy the declaration is refused with
a 400 naming the relation you probably wanted. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_edge_types(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return {"relations": relation_vocabulary(db)}


# ── Writing the relation vocabulary (ADR-0086) ───────────────────────
#
# ADR-0079 gave node types a v1 door and left edge types read-only here, reasoning that a
# relation created without endpoint declarations is what ADR-0078 closed. That reason does
# not survive inspection: the internal `/api/graph-types/edges` has always been able to
# create one with both declarations NULL, so the restriction never prevented an
# unconstrained relation — it only prevented an agent from reaching a state the UI reaches
# in two clicks, which is the "UI-only capability" shape ADR-0079 itself was written
# against. What ADR-0078 buys is that a *declared* rule is enforced, and that holds
# wherever the type was created.
#
# `admin`, matching node types: a relation is part of the shape other data is stored in.


@sub_router.get(
    "/edge-types/registry",
    response_model=list[EdgeTypeOut],
    summary="Edge types with usage counts",
    description=(
        "The registry rows themselves, each with `usage_count`, rather than the "
        "agent-facing vocabulary at `/edge-types`. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_edge_type_rows(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return type_registry.edge_types_with_usage(db)


@sub_router.get(
    "/edge-types/options/{node_type}",
    response_model=list[RelationOptionOut],
    summary="Relations a node type can take part in",
    description="""Which relations a node of this type may actually be an end of, and
which way round. `/edge-types` states each relation's declaration; this answers the
question a caller about to write an edge actually has — *given this node, what can I
link it to?* — by running the same predicate the write path enforces, once per
direction. `direction` is `outgoing` (write `this -> other`) or `incoming` (write
`other -> this`); a symmetric relation yields one option, since the reverse row is the
same edge. `other_types` resolves the far end to concrete type keys, so a caller never
needs its own copy of the role table. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_relation_options(
    node_type: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return type_registry.relation_options(db, node_type)


@sub_router.post(
    "/edge-types",
    response_model=EdgeTypeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a relation",
    description=(
        "Declares a new relation. Give it `allowed_source`/`allowed_target` as "
        "`{types, roles}` allow-lists unless it genuinely may connect anything — they are "
        "enforced on every edge write, and a relation without them constrains nothing "
        "(ADR-0078). Naming a role or node type that does not exist is a 422, because a "
        "rule carrying a typo is a rule that silently matches nothing. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_create_edge_type(body: EdgeTypeCreate, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    return _registry(lambda: type_registry.create_edge_type(db, body))


@sub_router.patch(
    "/edge-types/{key}",
    response_model=EdgeTypeOut,
    summary="Update a relation",
    description=(
        "Partial update. A built-in relation's structural flags (`is_containment`, "
        "`is_symmetric`) are frozen — flipping `contains.is_containment` would collapse "
        "every rollup in the system. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_update_edge_type(
    key: str, body: EdgeTypeUpdate, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "admin")
    return _registry(lambda: type_registry.update_edge_type(db, key, body))


@sub_router.delete(
    "/edge-types/{key}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a relation",
    description="Built-ins cannot be deleted, and neither can a relation still used by an edge. Requires `admin` scope.",
    responses=_auth_errors,
)
def api_delete_edge_type(key: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    _registry(lambda: type_registry.delete_edge_type(db, key))
