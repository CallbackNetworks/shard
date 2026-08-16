"""
External API v1 — Agent context (onboarding) endpoint.
"""

import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import AgentContextOut, AgentProjectInfo, AgentProjectTaskInfo
from app.services import graph
from app.services.graph_registry import relation_vocabulary, type_vocabulary

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
    if api_key.project_id:
        project = graph.get_project(db, api_key.project_id)
        projects = [project] if project and project.status == "active" else []
    else:
        projects = graph.all_projects(db, status="active")

    priority_order = {"high": 0, "medium": 1, "low": 2}

    project_infos = []
    for p in projects:
        label_names = [lb.name for lb in graph.labels_in_project(db, p.id) if lb.type == "label"]

        p_tasks = graph.subtree_task_views(db, p.id)
        sub = graph.subtask_ids_among(db, [t.id for t in p_tasks])
        active = [t for t in p_tasks if t.status in ("todo", "in_progress") and t.id not in sub]
        active.sort(
            key=lambda t: (
                0 if t.status == "in_progress" else 1,
                priority_order.get(t.priority, 2),
            )
        )
        active_task_infos = [
            AgentProjectTaskInfo(
                id=t.id,
                title=t.title,
                status=t.status,
                priority=t.priority,
                due_date=t.due_date,
            )
            for t in active[:10]
        ]

        project_infos.append(
            AgentProjectInfo(
                id=p.id,
                name=p.name,
                status=p.status,
                repo_url=p.repo_url,
                agent_instructions=p.agent_instructions,
                label_names=label_names,
                active_tasks=active_task_infos,
            )
        )

    global_instructions = os.environ.get("AGENT_CONTEXT_INSTRUCTIONS", "")

    return AgentContextOut(
        capabilities=[
            "projects",
            "tasks",
            "subtasks",
            "labels",
            "comments",
            "dependencies",
            "search",
            "analytics",
            "notifications",
            "webhooks",
            "workflow-rules",
            "attachments",
        ],
        instructions=global_instructions or None,
        conventions={
            "task_statuses": ["todo", "in_progress", "done", "failed"],
            "priorities": ["low", "medium", "high"],
            "naming": "Use clear, actionable task titles in imperative form",
            "progress": "Use POST .../progress to report intermediate progress (0-100%)",
            "write_surface": (
                "Every entity (task, project, label, cycle, goal, identity) is a node: create with "
                "POST /api/v1/nodes {type, title, container_id}, update with PATCH /api/v1/nodes/{id}, "
                "delete with DELETE /api/v1/nodes/{id}. Relationships are edges: attach with "
                "POST /api/v1/nodes/{source_id}/edges {target_id, rel_type} — see relations below. "
                "A node may have any number of parents; container_id on create is only the first one."
            ),
            # Both vocabularies are generated from the registries the write path
            # enforces (ADR-0078, ADR-0079). `type` is required on every node write and
            # nothing here used to say which values were legal.
            "node_types": type_vocabulary(db),
            # Generated from the edge-type registry the write path enforces (ADR-0078),
            # never restated here: the one endpoint an agent is told to call first said
            # only "Relationships are edges", so choosing between contains and owns was
            # a guess whose only feedback was a silently useless edge.
            "relations": relation_vocabulary(db),
            # Both directions of the CI/CD story, because for a long time only the
            # outbound one had a door an agent could reach (ADR-0084).
            "cicd": (
                "Outbound: POST /api/v1/subscriptions {callback_url, events} to be notified "
                "of platform events. Inbound: GET /api/v1/nodes/{id}/webhook (admin scope) "
                "returns the callback path and HMAC-SHA256 signing secret a CI provider "
                "posts build results to; POST /api/v1/nodes/{id}/webhook/rotate-secret "
                "replaces the secret. Unsigned callbacks are rejected."
            ),
        },
        projects=project_infos,
        quick_start=(
            "1. Call GET /api/v1/agent-context (this endpoint) to understand the platform. "
            "2. Call GET /api/v1/summary for current state of all projects and tasks. "
            '3. Create a task with POST /api/v1/nodes {"type": "task", "title": "...", '
            '"container_id": "<project id>"}. '
            '4. Update it with PATCH /api/v1/nodes/{node_id} {"status": "in_progress"}. '
            "5. Use POST /api/v1/projects/{id}/tasks/{id}/progress to report progress."
        ),
    )
