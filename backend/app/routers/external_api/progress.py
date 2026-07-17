"""
External API v1 — Task progress reporting endpoint.
"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Comment
from app.routers.external_api.auth import (
    _auth_errors,
    _build_actor,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404
from app.schemas import TaskOut, TaskProgressUpdate
from app.services import graph
from app.services.activity import log_activity
from app.services.enrichment import enrich_task
from app.services.ws_manager import ws_manager

sub_router = APIRouter()


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/progress",
    summary="Report task progress",
    description="""Atomically update task progress percentage and agent notes, optionally
adding a comment. Designed for AI agents to report intermediate progress on
long-running tasks. Requires `write` scope.

- `progress_pct`: 0-100 integer (null to clear)
- `agent_notes`: free-text markdown scratchpad for the agent
- `comment`: if provided, a comment is added to the task""",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
async def api_report_progress(
    project_id: str,
    task_id: str,
    body: TaskProgressUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
    x_agent_id: str | None = Header(None, alias="X-Agent-Id"),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)

    progress_changes: dict = {}
    if body.progress_pct is not None:
        progress_changes["progress_pct"] = body.progress_pct
    if body.agent_notes is not None:
        progress_changes["agent_notes"] = body.agent_notes
    if progress_changes:
        task = graph.update_task(db, task_id, **progress_changes)

    actor = _build_actor(api_key, x_agent_id)
    if body.comment:
        comment = Comment(
            task_id=task_id,
            body=body.comment,
            author=actor,
        )
        db.add(comment)

    log_activity(
        db,
        "task.progress_updated",
        project_id=project_id,
        task_id=task_id,
        actor=actor,
        detail=f'Task "{task.title}" progress updated to {body.progress_pct}%'
        if body.progress_pct is not None
        else f'Task "{task.title}" agent notes updated',
        meta={
            "progress_pct": body.progress_pct,
            "has_notes": body.agent_notes is not None,
            "has_comment": body.comment is not None,
            "agent_id": x_agent_id,
        },
    )

    db.commit()
    await ws_manager.broadcast("task.updated", {"id": task_id, "project_id": project_id})
    return enrich_task(graph.get_task(db, task_id), db)
