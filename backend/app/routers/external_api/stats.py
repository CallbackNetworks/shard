"""
External API v1 — Project stats and email status endpoints.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.schemas import EmailStatusOut, ProjectStatsOut
from app.services import graph

sub_router = APIRouter()


@sub_router.get(
    "/projects/{project_id}/stats",
    summary="Get project statistics",
    description="Returns task counts by status and priority, completion percentage, and overdue count. Requires `read` scope.",
    response_model=ProjectStatsOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_project_stats(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Same project, same numbers as the app's project page (ADR-0065): the whole
    # subtree, top-level tasks only, so the breakdown below adds up to the total.
    tasks = graph.subtree_task_views(db, project.id, top_level_only=True)
    total = len(tasks)
    by_status = {}
    by_priority = {}
    overdue = 0
    now = datetime.now(UTC)

    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
        if graph.is_overdue(t, now):
            overdue += 1

    done = by_status.get("done", 0)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "total_tasks": total,
        "done_tasks": done,
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "by_status": by_status,
        "by_priority": by_priority,
        "overdue_tasks": overdue,
    }


# ── Email config status ──────────────────────────────────────────


@sub_router.get(
    "/email/status",
    summary="Check SMTP configuration status",
    description="Returns whether SMTP email sending is configured and the current settings. Requires `read` scope.",
    response_model=EmailStatusOut,
    responses=_auth_errors,
)
def api_email_status(api_key: ApiKey = Depends(_get_api_key)):
    from app.services.email_sender import SMTP_FROM, SMTP_HOST, SMTP_PORT, is_configured

    _require_scope(api_key, "read")
    return {
        "configured": is_configured(),
        "smtp_host": SMTP_HOST or None,
        "smtp_port": SMTP_PORT,
        "smtp_from": SMTP_FROM or None,
    }
