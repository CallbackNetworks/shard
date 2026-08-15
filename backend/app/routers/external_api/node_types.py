"""
External API v1 — the node-type registry: what layers exist, and how to add one (ADR-0079).

`type` is a required field of every node write, and nothing under `/api/v1` said which
values were legal: an agent had to already know that `project` and `goal` exist and could
not discover a custom layer at all. Creating one was worse than undiscoverable — the
registry lived only under the internal `/api`, which a browser session reaches and an API
key does not, so a new layer could be created from the UI and by nothing else.

Reads take `read`; writes take `admin` rather than `write`, because a type is the shape
other data is stored in — the same standard by which deleting a container needs `admin`.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import NodeTypeCreate, NodeTypeOut, NodeTypeUpdate
from app.services import graph_registry as type_registry

sub_router = APIRouter()


def _registry(call):
    """Run a registry operation, reporting its refusal as HTTP.

    Same helper as the internal router's: both doors call one implementation, so a
    guard cannot hold on one surface and be absent on the other.
    """
    try:
        return call()
    except type_registry.TypeRegistryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@sub_router.get(
    "/node-types",
    summary="Node type registry",
    description="""Every node type (layer) with its label, roles, field declarations and
how many nodes use it. `roles` is what decides where a node of this type may sit:
`container` may parent other nodes via `contains`, `task` may be a subtask (see
`/api/v1/edge-types`). Use a `key` from here as the `type` of `POST /api/v1/nodes`.
Requires `read` scope.""",
    response_model=list[NodeTypeOut],
    responses=_auth_errors,
)
def api_list_node_types(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return type_registry.node_types_with_usage(db)


@sub_router.post(
    "/node-types",
    summary="Register a node type",
    description="""Creates a new layer, e.g. an `organization` above projects. Give it the
`container` role for it to hold other nodes. `fields` declares which keys of its nodes'
`data` belong to the user (ADR-0074); a key a feature writes is rejected. Requires
`admin` scope.""",
    response_model=NodeTypeOut,
    status_code=status.HTTP_201_CREATED,
    responses=_auth_errors,
)
def api_create_node_type(
    body: NodeTypeCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    return _registry(lambda: type_registry.create_node_type(db, body))


@sub_router.patch(
    "/node-types/{key}",
    summary="Update a node type",
    description="Built-in types refuse a change to their `container`/`task` roles. Requires `admin` scope.",
    response_model=NodeTypeOut,
    responses=_auth_errors,
)
def api_update_node_type(
    key: str,
    body: NodeTypeUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    return _registry(lambda: type_registry.update_node_type(db, key, body))


@sub_router.delete(
    "/node-types/{key}",
    summary="Delete a node type",
    description="Refused for a built-in type, or while any node still uses it. Requires `admin` scope.",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_auth_errors,
)
def api_delete_node_type(
    key: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    _registry(lambda: type_registry.delete_node_type(db, key))
