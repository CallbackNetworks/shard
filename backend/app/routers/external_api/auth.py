"""
Auth dependencies for External API v1.

Provides API key verification and scope/project access checks.
"""

import hashlib
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey


def _get_api_key(
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
    return api_key


def _require_scope(api_key: ApiKey, scope: str):
    if "admin" in api_key.scopes:
        return
    if scope not in api_key.scopes:
        raise HTTPException(status_code=403, detail=f"API key missing '{scope}' scope")


def _check_project_access(api_key: ApiKey, project_id: str):
    if api_key.project_id and api_key.project_id != project_id:
        raise HTTPException(status_code=403, detail="API key does not have access to this project")


def _node_project_id(db: Session, node) -> str | None:
    """The project that governs a node for access control (ADR-0042).

    A project node governs itself; any other node is governed by its nearest
    ``project``-type ``contains`` ancestor; a top-level node (goal/identity/orphan
    task) has no governing project.
    """
    from app.services import graph

    if node.type == graph.NODE_PROJECT:
        return node.id
    ancestor = graph.nearest_ancestor_of_type(db, node.id, graph.NODE_PROJECT)
    return ancestor.id if ancestor is not None else None


def _node_accessible(api_key: ApiKey, db: Session, node) -> bool:
    """Whether a project-scoped key may see/touch this node (unrestricted keys: always)."""
    return not api_key.project_id or _node_project_id(db, node) == api_key.project_id


def _check_node_access(api_key: ApiKey, db: Session, node):
    """403 unless the key governs this node's project (ADR-0042)."""
    if not _node_accessible(api_key, db, node):
        raise HTTPException(status_code=403, detail="API key does not have access to this node")


def _check_create_access(api_key: ApiKey, db: Session, container_id: str | None, parent_id: str | None):
    """403 unless a new node's governing project matches a project-scoped key (ADR-0042).

    The target project is resolved from the containment hint; a project-scoped key
    therefore cannot create top-level nodes (project/goal/identity/orphan task) — those
    need an unrestricted key.
    """
    if not api_key.project_id:
        return
    from app.services import graph

    ref = container_id or parent_id
    ref_node = graph.get_node(db, ref) if ref is not None else None
    target_project = _node_project_id(db, ref_node) if ref_node is not None else None
    if target_project != api_key.project_id:
        raise HTTPException(status_code=403, detail="API key can only create nodes within its project")


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
