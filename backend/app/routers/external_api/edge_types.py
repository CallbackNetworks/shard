"""
External API v1 — the relation vocabulary (ADR-0078).

An agent could always write edges (`POST /api/v1/nodes/{id}/edges`) but had no way
to read what the relations mean or what may sit at their ends: the internal registry
was never exposed under `/api/v1`, so picking the wrong one was a guess whose only
feedback was a silently useless edge.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.services.graph_registry import relation_vocabulary

sub_router = APIRouter()


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
