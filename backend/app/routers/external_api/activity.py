"""
External API v1 — Activity log endpoint.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import ActivityEntryOut

sub_router = APIRouter()


@sub_router.get(
    "/activity",
    summary="Get activity log",
    description="""Returns recent activity log entries. Useful for AI agents to understand what changed recently.

Activities are recorded for: task creation, status changes, assignee changes, deletions, webhook callbacks, and project mutations. Requires `read` scope.""",
    response_model=list[ActivityEntryOut],
    responses=_auth_errors,
)
def api_activity(
    project_id: str | None = Query(None, description="Filter by project ID (optional)"),
    limit: int = Query(50, description="Max entries to return (1-200)", ge=1, le=200),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    query = db.query(ActivityLog)
    if api_key.project_id:
        query = query.filter(ActivityLog.project_id == api_key.project_id)
    elif project_id:
        query = query.filter(ActivityLog.project_id == project_id)
    entries = query.order_by(ActivityLog.created_at.desc()).limit(min(limit, 200)).all()
    return [
        {
            "id": a.id,
            "project_id": a.project_id,
            "task_id": a.task_id,
            "action": a.action,
            "actor": a.actor,
            "detail": a.detail,
            "meta": a.meta,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in entries
    ]
