"""
External API v1 — Agent context (onboarding) endpoint.
"""

import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Project
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import AgentContextOut, AgentProjectInfo

sub_router = APIRouter()


@sub_router.get(
    "/agent-context",
    summary="Agent onboarding context",
    description="""Returns platform capabilities, conventions, per-project agent instructions,
and a quick-start guide. Designed as the first endpoint an AI agent should call
to understand the platform and how to interact with it. Requires `read` scope.""",
    response_model=AgentContextOut,
    responses=_auth_errors,
)
def api_agent_context(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    query = db.query(Project).filter(Project.status == "active")
    if api_key.project_id:
        query = query.filter(Project.id == api_key.project_id)
    projects = query.order_by(Project.created_at.desc()).all()

    project_infos = []
    for p in projects:
        label_names = [lb.name for lb in p.labels if lb.type == "label"]
        project_infos.append(
            AgentProjectInfo(
                id=p.id,
                name=p.name,
                status=p.status,
                agent_instructions=p.agent_instructions,
                label_names=label_names,
            )
        )

    global_instructions = os.environ.get("AGENT_CONTEXT_INSTRUCTIONS", "")

    return AgentContextOut(
        capabilities=[
            "projects", "tasks", "subtasks", "labels", "comments",
            "dependencies", "search", "analytics", "notifications",
            "webhooks", "workflow-rules", "attachments",
        ],
        instructions=global_instructions or None,
        conventions={
            "task_statuses": ["todo", "in_progress", "done", "failed"],
            "priorities": ["low", "medium", "high"],
            "naming": "Use clear, actionable task titles in imperative form",
            "progress": "Use POST .../progress to report intermediate progress (0-100%)",
        },
        projects=project_infos,
        quick_start=(
            "1. Call GET /api/v1/agent-context (this endpoint) to understand the platform. "
            "2. Call GET /api/v1/summary for current state of all projects and tasks. "
            "3. Use POST /api/v1/projects/{id}/tasks to create tasks. "
            "4. Use PATCH /api/v1/projects/{id}/tasks/{id} to update task status/fields. "
            "5. Use POST /api/v1/projects/{id}/tasks/{id}/progress to report progress."
        ),
    )
