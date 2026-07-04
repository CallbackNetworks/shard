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
