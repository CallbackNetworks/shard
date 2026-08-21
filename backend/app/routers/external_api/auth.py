"""
Auth dependencies for External API v1.

Provides API key verification and scope/project access checks.
"""

import hashlib
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey


def _get_api_key(
    request: Request,
    x_api_key: str = Header(
        ..., alias="X-API-Key", description="API key (starts with tdp_). Create one in the API Keys page."
    ),
    db: Session = Depends(get_db),
) -> ApiKey:
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    api_key = db.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.active == True).first()
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    api_key.last_used_at = datetime.now(UTC)
    db.commit()
    # Read back by the credential-redaction middleware after the route has produced its
    # response (ADR-0059). Every v1 endpoint already depends on this function, so the
    # middleware learns the caller's authority without a second lookup.
    request.state.api_key_scopes = list(api_key.scopes or [])
    return api_key


def _require_scope(api_key: ApiKey, scope: str):
    if "admin" in api_key.scopes:
        return
    if scope not in api_key.scopes:
        raise HTTPException(status_code=403, detail=f"API key missing '{scope}' scope")


def _container_ids_for(db: Session, node_id: str) -> set[str]:
    """A node's own id plus every ``contains`` ancestor (ADR-0107).

    A key scoped to a project matches only that project; a key scoped to an
    identity matches it and everything the identity contains, transitively —
    the same rule, no distinction between the two container types.
    """
    from app.services import graph

    return {node_id} | {a.id for a in graph.ancestors_of(db, node_id)}


def _check_project_access(db: Session, api_key: ApiKey, project_id: str):
    if api_key.container_id and api_key.container_id not in _container_ids_for(db, project_id):
        raise HTTPException(status_code=403, detail="API key does not have access to this project")


def _node_accessible(api_key: ApiKey, db: Session, node) -> bool:
    """Whether a container-scoped key may see/touch this node (unrestricted keys: always)."""
    return not api_key.container_id or api_key.container_id in _container_ids_for(db, node.id)


def _check_node_access(api_key: ApiKey, db: Session, node):
    """403 unless the key's container governs this node (ADR-0107)."""
    if not _node_accessible(api_key, db, node):
        raise HTTPException(status_code=403, detail="API key does not have access to this node")


def _project_ids_in_scope(db: Session, api_key: ApiKey) -> list[str] | None:
    """Every project id a container-scoped key may act on; ``None`` means unrestricted (ADR-0107).

    A project-scoped key resolves to itself; an identity-scoped key (or any other
    container) resolves to every project in its ``contains`` subtree — there is no
    single default project to fall back to, so callers needing one must decide
    what an empty or multi-project result means for them.
    """
    from app.models import Node
    from app.services import graph

    if not api_key.container_id:
        return None
    node = graph.get_node(db, api_key.container_id)
    if node is not None and node.type == graph.NODE_PROJECT:
        return [api_key.container_id]
    subtree_ids = graph.descendants_of(db, api_key.container_id)
    if not subtree_ids:
        return []
    rows = db.query(Node.id).filter(Node.id.in_(subtree_ids), Node.type == graph.NODE_PROJECT).all()
    return [r[0] for r in rows]


def _projects_in_scope(db: Session, api_key: ApiKey, *, status: str | None = None) -> list:
    """The project objects ``_project_ids_in_scope`` resolves to, status-filtered like ``graph.all_projects``."""
    from app.services import graph

    project_ids = _project_ids_in_scope(db, api_key)
    if project_ids is None:
        return graph.all_projects(db, status=status)
    projects = [p for pid in project_ids if (p := graph.get_project(db, pid)) is not None]
    if status:
        projects = [p for p in projects if p.status == status]
    return projects


def _resolve_project_scope(
    db: Session, api_key: ApiKey, project_id: str | None, *, required: bool = False
) -> str | None:
    """A single project id to filter a read by, validated against a container-scoped key.

    An explicit id must fall inside the key's scope (403 otherwise). With no explicit id, a
    key scoped to exactly one project defaults to it; a key scoped to more than one (an
    identity with several projects) has no single default that wouldn't either narrow
    silently or leak outside its scope, so the caller must say which one (400).
    """
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    if project_id is not None:
        if scoped_project_ids is not None and project_id not in scoped_project_ids:
            raise HTTPException(status_code=403, detail="API key does not have access to this project")
        return project_id
    if scoped_project_ids is None:
        if required:
            raise HTTPException(status_code=400, detail="project_id is required")
        return None
    if len(scoped_project_ids) == 1:
        return scoped_project_ids[0]
    raise HTTPException(status_code=400, detail="project_id is required for a key scoped to more than one project")


def _check_create_access(api_key: ApiKey, db: Session, container_id: str | None, parent_id: str | None):
    """403 unless a new node's containment hint falls under a container-scoped key (ADR-0107).

    The target is resolved from the containment hint; a container-scoped key
    therefore cannot create top-level nodes (project/goal/identity/orphan task) —
    those need an unrestricted key.
    """
    if not api_key.container_id:
        return
    ref = container_id or parent_id
    if ref is None or api_key.container_id not in _container_ids_for(db, ref):
        raise HTTPException(status_code=403, detail="API key can only create nodes within its scope")


def _build_actor(api_key: ApiKey, agent_id: str | None = None) -> str:
    """Build actor string for activity logs, including agent ID if provided."""
    base = f"api:{api_key.name}"
    if agent_id:
        return f"{base}:{agent_id}"
    return base


_auth_errors = {
    401: {"description": "Invalid or inactive API key"},
    403: {"description": "Insufficient scope or project access denied"},
}
