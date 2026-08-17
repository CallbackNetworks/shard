#!/usr/bin/env python3
"""MCP server exposing Shard tools over stdio and Streamable HTTP.

Proxies all operations through the backend HTTP API (/api/v1) to ensure
business logic (activity logging, notifications, workflow rules, WebSocket
broadcasts) is applied consistently.  See ADR-0005 for rationale.

Built on the SDK's ``MCPServer`` (ADR-0077): tools, resources and prompts are
declared with decorators and their schemas come from the signatures, so the
registry cannot drift from the dispatch — there is no dispatch.
"""

import asyncio
import json
import os
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

# Value vocabularies the backend already enforces. Declared once here so the
# generated tool schemas carry the same enums the hand-written ones did — a
# picker and its writer must not disagree (ADR-0056).
TaskStatus = Literal["todo", "in_progress", "done", "failed"]
Priority = Literal["low", "medium", "high"]
ProjectStatus = Literal["active", "archived"]
ManageAction = Literal["list", "add", "remove"]
WebhookAction = Literal["reveal", "rotate_secret", "rotate_token", "history"]
SettingsAction = Literal["get", "bounds", "update", "ical_token", "rotate_ical_token"]
BackupAction = Literal["status", "run", "restore"]

API_BASE_URL = os.environ.get("API_BASE_URL", "http://backend:8000")
API_KEY = os.environ.get("API_KEY", "")

mcp = MCPServer("shard", version="1.0.0")

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=f"{API_BASE_URL}/api/v1",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
    return _http_client


async def _get(path: str, params: dict | None = None) -> dict | list | str:
    client = _get_client()
    resp = await client.get(path, params=params)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    return resp.json()


async def _post(path: str, body: dict | list | None = None, params: dict | None = None) -> dict | list | str:
    client = _get_client()
    resp = await client.post(path, json=body, params=params)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    if resp.status_code == 204:
        return {"status": "ok"}
    return resp.json()


async def _patch(path: str, body: dict | None = None) -> dict | list | str:
    client = _get_client()
    resp = await client.patch(path, json=body)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    return resp.json()


async def _put(path: str, body: dict | None = None) -> dict | list | str:
    client = _get_client()
    resp = await client.put(path, json=body)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    return resp.json()


async def _delete(path: str) -> dict | str:
    client = _get_client()
    resp = await client.delete(path)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    if resp.status_code == 204:
        return {"status": "deleted"}
    return resp.json()


def _as_text(data) -> str:
    """Resource bodies are JSON text; a tool-style error string passes through."""
    return data if isinstance(data, str) else json.dumps(data, indent=2)


# ── Tool implementations ────────────────────────────────────────────


async def _get_summary() -> str:
    result = await _get("/summary")
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_tasks(project_id: str, status: str | None = None, priority: str | None = None) -> str:
    params = {}
    if status:
        params["status_filter"] = status
    if priority:
        params["priority"] = priority
    result = await _get(f"/projects/{project_id}/tasks", params=params)
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_task(
    project_id: str,
    title: str,
    priority: str = "medium",
    description: str | None = None,
    assignee: str | None = None,
    due_date: str | None = None,
) -> str:
    body: dict = {"title": title, "priority": priority}
    if description:
        body["description"] = description
    if assignee:
        body["assignee"] = assignee
    if due_date:
        body["due_date"] = due_date
    # ADR-0042: task writes go through the graph-native node surface.
    result = await _post("/nodes", {"type": "task", "container_id": project_id, **body})
    return json.dumps(result) if not isinstance(result, str) else result


async def _update_task(project_id: str, task_id: str, **kwargs) -> str:
    body = {k: v for k, v in kwargs.items() if v is not None}
    if not body:
        return "No fields to update"
    result = await _patch(f"/nodes/{task_id}", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_subtask(project_id: str, parent_task_id: str, title: str, priority: str = "medium") -> str:
    body = {
        "type": "task",
        "container_id": project_id,
        "parent_id": parent_task_id,
        "title": title,
        "priority": priority,
    }
    result = await _post("/nodes", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_labels(
    action: str,
    project_id: str | None = None,
    task_id: str | None = None,
    label_id: str | None = None,
) -> str:
    if action == "list":
        if not project_id:
            return "project_id required for list action"
        result = await _get(f"/projects/{project_id}/labels")
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "add":
        if not project_id or not task_id or not label_id:
            return "project_id, task_id, and label_id required for add action"
        result = await _post(f"/projects/{project_id}/tasks/{task_id}/labels/{label_id}")
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "remove":
        if not project_id or not task_id or not label_id:
            return "project_id, task_id, and label_id required for remove action"
        result = await _delete(f"/projects/{project_id}/tasks/{task_id}/labels/{label_id}")
        return json.dumps(result) if not isinstance(result, str) else result

    return f"Unknown label action: {action}"


async def _analyze_workload(project_id: str | None = None) -> str:
    if project_id:
        result = await _get(f"/projects/{project_id}/stats")
    else:
        result = await _get("/analytics/overview")
    return json.dumps(result) if not isinstance(result, str) else result


async def _search(query: str) -> str:
    result = await _get("/search", params={"q": query, "limit": 20})
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_activity(limit: int = 20) -> str:
    result = await _get("/activity", params={"limit": limit})
    return json.dumps(result) if not isinstance(result, str) else result


async def _add_comment(project_id: str, task_id: str, body: str, author: str | None = None) -> str:
    payload: dict = {"body": body}
    if author:
        payload["author"] = author
    result = await _post(f"/projects/{project_id}/tasks/{task_id}/comments", payload)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_comments(project_id: str, task_id: str) -> str:
    result = await _get(f"/projects/{project_id}/tasks/{task_id}/comments")
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_dependencies(
    action: str,
    project_id: str,
    task_id: str,
    depends_on_id: str | None = None,
) -> str:
    if action == "list":
        result = await _get(f"/projects/{project_id}/tasks/{task_id}/dependencies")
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "add":
        if not depends_on_id:
            return "depends_on_id required for add action"
        result = await _post(f"/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}")
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "remove":
        if not depends_on_id:
            return "depends_on_id required for remove action"
        result = await _delete(f"/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}")
        return json.dumps(result) if not isinstance(result, str) else result

    return f"Unknown dependency action: {action}"


async def _get_notifications(unread_only: bool = True, limit: int = 20) -> str:
    params = {"unread_only": str(unread_only).lower(), "limit": limit}
    result = await _get("/notifications", params=params)
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_agent_context() -> str:
    result = await _get("/agent-context")
    return json.dumps(result) if not isinstance(result, str) else result


async def _report_progress(
    project_id: str,
    task_id: str,
    progress_pct: int | None = None,
    agent_notes: str | None = None,
    comment: str | None = None,
) -> str:
    body: dict = {}
    if progress_pct is not None:
        body["progress_pct"] = progress_pct
    if agent_notes is not None:
        body["agent_notes"] = agent_notes
    if comment is not None:
        body["comment"] = comment
    result = await _post(f"/projects/{project_id}/tasks/{task_id}/progress", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_projects(status: str | None = None) -> str:
    params = {}
    if status:
        params["status"] = status
    result = await _get("/projects", params=params)
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_project(
    name: str,
    description: str | None = None,
) -> str:
    # ADR-0042: a project is a node — create it through the graph-native surface.
    body: dict = {"type": "project", "title": name}
    if description:
        body["data"] = {"description": description}
    result = await _post("/nodes", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _delete_task(project_id: str, task_id: str) -> str:
    result = await _delete(f"/nodes/{task_id}")
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_project_detail(project_id: str) -> str:
    result = await _get(f"/projects/{project_id}")
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_container_subtree(node_id: str) -> str:
    result = await _get(f"/nodes/{node_id}/subtree")
    return json.dumps(result) if not isinstance(result, str) else result


async def _bulk_update_tasks(project_id: str, updates: list[dict]) -> str:
    result = await _post(f"/projects/{project_id}/tasks/bulk-update", updates)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_node_types() -> str:
    result = await _get("/node-types")
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_node_type(key: str, label: str, roles: list[str] | None = None) -> str:
    body: dict = {"key": key, "label": label}
    if roles:
        body["roles"] = roles
    result = await _post("/node-types", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_edge_types() -> str:
    result = await _get("/edge-types")
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_edges(
    action: str,
    node_id: str,
    target_id: str | None = None,
    rel_type: str | None = None,
) -> str:
    if action == "list":
        result = await _get(f"/nodes/{node_id}/edges")
    elif action == "add":
        if not target_id or not rel_type:
            return "Error: target_id and rel_type are required to add an edge"
        result = await _post(f"/nodes/{node_id}/edges", {"target_id": target_id, "rel_type": rel_type})
    elif action == "remove":
        if not target_id or not rel_type:
            return "Error: target_id and rel_type are required to remove an edge"
        result = await _delete(f"/nodes/{node_id}/edges?target_id={target_id}&rel_type={rel_type}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_webhook(action: str, node_id: str) -> str:
    if action == "reveal":
        result = await _get(f"/nodes/{node_id}/webhook")
    elif action == "rotate_secret":
        result = await _post(f"/nodes/{node_id}/webhook/rotate-secret")
    elif action == "rotate_token":
        result = await _post(f"/nodes/{node_id}/webhook/rotate-token")
    elif action == "history":
        result = await _get(f"/nodes/{node_id}/webhook-events")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _trigger_pipeline(provider: str, config: dict, task_id: str | None = None) -> str:
    params = {"task_id": task_id} if task_id else None
    result = await _post(f"/cicd/trigger/{provider}", config, params=params)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_integrations() -> str:
    result = await _get("/integrations")
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_integration(action: str, integration_id: str | None = None, config: dict | None = None) -> str:
    if action == "create":
        if not config:
            return "Error: config is required to create an integration"
        result = await _post("/integrations", config)
    elif action == "update":
        if not integration_id or not config:
            return "Error: integration_id and config are required to update an integration"
        result = await _patch(f"/integrations/{integration_id}", config)
    elif action == "delete":
        if not integration_id:
            return "Error: integration_id is required to delete an integration"
        result = await _delete(f"/integrations/{integration_id}")
    elif action == "test":
        if not integration_id:
            return "Error: integration_id is required to test an integration"
        result = await _post(f"/integrations/{integration_id}/test")
    elif action == "events":
        result = await _get("/integrations/events")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_deliveries(integration_id: str | None = None, status: str | None = None, limit: int = 20) -> str:
    params = {"limit": limit}
    if integration_id:
        params["integration_id"] = integration_id
    if status:
        params["status"] = status
    result = await _get("/deliveries", params=params)
    return json.dumps(result) if not isinstance(result, str) else result


async def _retry_delivery(delivery_id: str) -> str:
    result = await _post(f"/deliveries/{delivery_id}/retry")
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_rule_vocabulary(project_id: str | None = None) -> str:
    result = await _get("/workflow-rules/vocabulary", params={"project_id": project_id} if project_id else None)
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_workflow_rules(
    action: str,
    rule_id: str | None = None,
    config: dict | None = None,
    project_id: str | None = None,
    node_id: str | None = None,
) -> str:
    if action == "list":
        result = await _get("/workflow-rules", params={"project_id": project_id} if project_id else None)
    elif action == "get":
        if not rule_id:
            return "Error: rule_id is required"
        result = await _get(f"/workflow-rules/{rule_id}")
    elif action == "create":
        if not config:
            return "Error: config is required to create a rule"
        result = await _post("/workflow-rules", config)
    elif action == "update":
        if not rule_id or not config:
            return "Error: rule_id and config are required to update a rule"
        result = await _patch(f"/workflow-rules/{rule_id}", config)
    elif action == "delete":
        if not rule_id:
            return "Error: rule_id is required"
        result = await _delete(f"/workflow-rules/{rule_id}")
    elif action == "test":
        if not rule_id or not node_id:
            return "Error: rule_id and node_id are required to test a rule"
        result = await _post(f"/workflow-rules/{rule_id}/test", None, params={"node_id": node_id})
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_attachments(
    action: str,
    project_id: str,
    task_id: str,
    filename: str | None = None,
    content_base64: str | None = None,
    content_type: str | None = None,
    attachment_id: str | None = None,
) -> str:
    base = f"/projects/{project_id}/tasks/{task_id}/attachments"
    if action == "list":
        result = await _get(base)
    elif action == "upload":
        if not filename or not content_base64:
            return "Error: filename and content_base64 are required to upload"
        body = {"filename": filename, "content_base64": content_base64, "content_type": content_type}
        result = await _post(base, body)
    elif action == "delete":
        if not attachment_id:
            return "Error: attachment_id is required to delete"
        result = await _delete(f"{base}/{attachment_id}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_settings(action: str, settings: dict | None = None) -> str:
    if action == "get":
        result = await _get("/settings")
    elif action == "bounds":
        result = await _get("/settings/bounds")
    elif action == "update":
        if not settings:
            return "Error: settings is required to update"
        result = await _put("/settings/system", settings)
    elif action == "ical_token":
        result = await _get("/settings/ical-token")
    elif action == "rotate_ical_token":
        result = await _post("/settings/ical-token/rotate")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_backup(action: str, filename: str | None = None, confirm: str = "") -> str:
    if action == "status":
        result = await _get("/backup/status")
    elif action == "run":
        result = await _post("/backup/run")
    elif action == "restore":
        if not filename:
            return "Error: filename is required to restore"
        result = await _post(f"/backup/restore/{filename}", None, params={"confirm": confirm})
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


# ── MCP tools ────────────────────────────────────────────────────────
#
# One decorated function per tool (ADR-0077). The schema is derived from the
# signature, so the parameter list *is* the contract — the hand-written
# ``inputSchema`` blocks and the 20-branch ``if name == ...`` dispatch they fed
# are both gone. Forgetting a branch is no longer expressible.
#
# Each wrapper stays a thin shell over the ``_`` implementation below it: those
# are what the suite mocks httpx against, and keeping them untouched is what
# let this migration reuse its own test harness instead of rewriting it.


@mcp.tool(
    description=(
        "Get a comprehensive summary of the entire platform: project stats, "
        "identity breakdown, active/overdue tasks, and recent activity. "
        "This is the best starting point for understanding current state."
    )
)
async def get_summary() -> str:
    return await _get_summary()


@mcp.tool(description="List tasks for a project, optionally filtered by status and/or priority.")
async def list_tasks(
    project_id: str,
    status: TaskStatus | None = None,
    priority: Priority | None = None,
) -> str:
    return await _list_tasks(project_id, status, priority)


@mcp.tool(description="Create a new task in a project.")
async def create_task(
    project_id: str,
    title: str,
    priority: Priority = "medium",
    description: str | None = None,
    assignee: str | None = None,
    due_date: str | None = None,
) -> str:
    """due_date is YYYY-MM-DD."""
    return await _create_task(
        project_id=project_id,
        title=title,
        priority=priority,
        description=description,
        assignee=assignee,
        due_date=due_date,
    )


@mcp.tool(
    description=(
        "Update task fields: status, priority, title, description, assignee, " "due_date, time_estimate, time_spent."
    )
)
async def update_task(
    project_id: str,
    task_id: str,
    status: TaskStatus | None = None,
    priority: Priority | None = None,
    title: str | None = None,
    description: str | None = None,
    assignee: str | None = None,
    due_date: str | None = None,
    time_estimate: int | None = None,
    time_spent: int | None = None,
) -> str:
    """due_date is YYYY-MM-DD; time_estimate and time_spent are minutes."""
    return await _update_task(
        project_id,
        task_id,
        status=status,
        priority=priority,
        title=title,
        description=description,
        assignee=assignee,
        due_date=due_date,
        time_estimate=time_estimate,
        time_spent=time_spent,
    )


@mcp.tool(description="Create a subtask under an existing task.")
async def create_subtask(
    project_id: str,
    parent_task_id: str,
    title: str,
    priority: Priority = "medium",
) -> str:
    return await _create_subtask(
        project_id=project_id,
        parent_task_id=parent_task_id,
        title=title,
        priority=priority,
    )


@mcp.tool(description="Add or remove a label from a task, or list labels for a project.")
async def manage_labels(
    action: ManageAction,
    project_id: str,
    task_id: str | None = None,
    label_id: str | None = None,
) -> str:
    """task_id and label_id are required for add/remove."""
    return await _manage_labels(
        action=action,
        project_id=project_id,
        task_id=task_id,
        label_id=label_id,
    )


@mcp.tool(
    description=(
        "Analyze workload: tasks by status, priority, overdue count. Pass project_id "
        "for per-project stats, omit for platform overview."
    )
)
async def analyze_workload(project_id: str | None = None) -> str:
    return await _analyze_workload(project_id)


@mcp.tool(description="Search for tasks and projects by keyword (searches titles and descriptions).")
async def search(query: str) -> str:
    return await _search(query)


@mcp.tool(description="Get recent activity log entries showing what changed and who did it.")
async def get_activity(limit: int = 20) -> str:
    """limit defaults to 20, max 200."""
    return await _get_activity(limit)


@mcp.tool(description="Add a comment to a task. Useful for leaving notes, progress updates, or context.")
async def add_comment(
    project_id: str,
    task_id: str,
    body: str,
    author: str | None = None,
) -> str:
    """body supports markdown; author defaults to the API key name."""
    return await _add_comment(
        project_id=project_id,
        task_id=task_id,
        body=body,
        author=author,
    )


@mcp.tool(description="List all comments on a task in chronological order.")
async def list_comments(project_id: str, task_id: str) -> str:
    return await _list_comments(project_id, task_id)


@mcp.tool(description="View, add, or remove task dependencies (blocker relationships).")
async def manage_dependencies(
    action: ManageAction,
    project_id: str,
    task_id: str,
    depends_on_id: str | None = None,
) -> str:
    """list: view blockers/dependents. add/remove: needs depends_on_id, the blocking task."""
    return await _manage_dependencies(
        action=action,
        project_id=project_id,
        task_id=task_id,
        depends_on_id=depends_on_id,
    )


@mcp.tool(description="Get in-app notifications. Useful for checking what events occurred recently.")
async def get_notifications(unread_only: bool = True, limit: int = 20) -> str:
    return await _get_notifications(unread_only=unread_only, limit=limit)


@mcp.tool(
    description=(
        "Get platform onboarding context: capabilities, conventions, per-project "
        "agent instructions, and a quick-start guide. Call this first to understand "
        "how to interact with the platform."
    )
)
async def get_agent_context() -> str:
    return await _get_agent_context()


@mcp.tool(
    description=(
        "Report intermediate progress on a task. Updates progress percentage, agent "
        "notes, and optionally adds a comment."
    )
)
async def report_progress(
    project_id: str,
    task_id: str,
    progress_pct: int | None = None,
    agent_notes: str | None = None,
    comment: str | None = None,
) -> str:
    """progress_pct is 0-100; agent_notes supports markdown."""
    return await _report_progress(
        project_id=project_id,
        task_id=task_id,
        progress_pct=progress_pct,
        agent_notes=agent_notes,
        comment=comment,
    )


@mcp.tool(description="List all projects, optionally filtered by status (active/archived).")
async def list_projects(status: ProjectStatus | None = None) -> str:
    return await _list_projects(status)


@mcp.tool(description="Create a new project.")
async def create_project(name: str, description: str | None = None) -> str:
    return await _create_project(name=name, description=description)


@mcp.tool(description="Permanently delete a task from a project.")
async def delete_task(project_id: str, task_id: str) -> str:
    return await _delete_task(project_id=project_id, task_id=task_id)


@mcp.tool(
    description=(
        "Get a single project with all its tasks, labels, and progress stats in one "
        "call. More efficient than listing projects then listing tasks separately."
    )
)
async def get_project_detail(project_id: str) -> str:
    return await _get_project_detail(project_id=project_id)


@mcp.tool(
    description=(
        "Get a container's task rollup over everything it contains, plus the containers "
        "directly inside it (each with its own rollup). Use this on a project or any "
        "container to find work that lives one or more levels down: list_tasks and "
        "get_project_detail only show a container's own tasks, not nested containers."
    )
)
async def get_container_subtree(node_id: str) -> str:
    """node_id is a project, goal or custom container."""
    return await _get_container_subtree(node_id=node_id)


@mcp.tool(
    description=(
        "Batch update multiple tasks in one request. Each item needs an 'id' field and "
        "the fields to change. Status changes trigger notifications."
    )
)
async def bulk_update_tasks(project_id: str, updates: list[dict]) -> str:
    """Each update is an object with 'id' plus fields to change: status, priority, title, ..."""
    return await _bulk_update_tasks(project_id=project_id, updates=updates)


@mcp.tool(
    description=(
        "List the node types (layers) that exist, with the roles that decide where a "
        "node of each type may sit. The 'type' field of a node write must be a key from "
        "here — call this before inventing one."
    )
)
async def list_node_types() -> str:
    """No arguments; returns every registered node type."""
    return await _list_node_types()


@mcp.tool(
    description=(
        "Register a new node type (a new layer, e.g. an 'organization' above projects). "
        "Pass roles=['container'] for a layer that holds other nodes. Requires an admin "
        "API key. Creating a type is rare — check list_node_types first."
    )
)
async def create_node_type(key: str, label: str, roles: list[str] | None = None) -> str:
    """key is the lowercase identifier written into each node's `type`."""
    return await _create_node_type(key=key, label=label, roles=roles)


@mcp.tool(
    description=(
        "List the relation vocabulary: every edge type, what it means, and which node "
        "types/roles may sit at each end. Call this before manage_edges — the endpoint "
        "rules are enforced on write, so an edge with the wrong relation is refused."
    )
)
async def list_edge_types() -> str:
    """No arguments; returns the relations an edge may declare."""
    return await _list_edge_types()


@mcp.tool(
    description=(
        "List, attach or detach a node's relationships. Direction is source -> target, "
        "so call it on the *parent* to file a child under it. 'contains' says where a "
        "node lives (it drives every rollup) and 'owns' says which identity it belongs "
        "to — a node may have any number of parents. See list_edge_types for the rest."
    )
)
async def manage_edges(
    action: ManageAction,
    node_id: str,
    target_id: str | None = None,
    rel_type: str | None = None,
) -> str:
    """node_id is the edge's source; target_id + rel_type are required for add/remove."""
    return await _manage_edges(action=action, node_id=node_id, target_id=target_id, rel_type=rel_type)


@mcp.tool(
    description=(
        "Configure inbound CI/CD callbacks for a task or project (ADR-0084, ADR-0085). "
        "'reveal' returns the callback_token, the HMAC-SHA256 signing secret and the path "
        "to POST build results to, minting them if the node has none. 'rotate_secret' "
        "issues a new signing key; 'rotate_token' issues a new callback *address*, for when "
        "the URL itself has leaked. 'history' lists the build results received so far. "
        "Give the returned path and secret to the CI provider — unsigned callbacks are "
        "rejected. Everything but 'history' needs an admin-scope API key: these credentials "
        "are an unauthenticated write path into the platform."
    )
)
async def manage_webhook(action: WebhookAction, node_id: str) -> str:
    """node_id is the task or project that should receive the build results."""
    return await _manage_webhook(action=action, node_id=node_id)


@mcp.tool(
    description=(
        "Start a CI/CD pipeline (ADR-0085). `config` carries what the provider needs and "
        "its credential, which is never stored: github needs {repo, workflow_id, token, "
        "ref?, inputs?, api_base?}; gitlab {project_id, token, ref?, variables?, "
        "gitlab_url?}; jenkins {url, token?, username?, parameters?}; generic {url, method?, "
        "headers?, body?}. Pass task_id to record the trigger against that task's activity, "
        "which is how a build gets tied to the work that caused it."
    )
)
async def trigger_pipeline(
    provider: Literal["github", "gitlab", "jenkins", "generic"],
    config: dict,
    task_id: str | None = None,
) -> str:
    return await _trigger_pipeline(provider=provider, config=config, task_id=task_id)


@mcp.tool(
    description=(
        "List outbound integrations: where this platform sends notifications, by webhook or "
        "email. Credentials never come back — a set secret reads as secret_set: true."
    )
)
async def list_integrations() -> str:
    return await _list_integrations()


@mcp.tool(
    description=(
        "Create, update, delete or test an outbound integration (ADR-0085). `config` for "
        "'create' takes {name, type, url|email_to, events[], secret?, auth_type?, "
        "auth_config?, custom_headers?, project_id?}. Use action='events' first to see which "
        "event names are deliverable — an unknown one is refused. 'test' fires a synthetic "
        "delivery and returns what the target answered. On update, a null credential value "
        "means unchanged, not deleted (ADR-0063)."
    )
)
async def manage_integration(
    action: Literal["create", "update", "delete", "test", "events"],
    integration_id: str | None = None,
    config: dict | None = None,
) -> str:
    return await _manage_integration(action=action, integration_id=integration_id, config=config)


@mcp.tool(
    description=(
        "List outbound webhook delivery attempts, newest first, with the response the target "
        "gave and the next scheduled retry. The failure mode of a webhook is silence, so "
        "this is how you find out yours is not arriving. Filter by integration_id or status "
        "(pending/success/failed/dead)."
    )
)
async def list_deliveries(integration_id: str | None = None, status: str | None = None, limit: int = 20) -> str:
    return await _list_deliveries(integration_id=integration_id, status=status, limit=limit)


@mcp.tool(description="Retry one failed or dead webhook delivery. The retry backoff starts over.")
async def retry_delivery(delivery_id: str) -> str:
    return await _retry_delivery(delivery_id=delivery_id)


@mcp.tool(
    description=(
        "Read or change how this instance behaves (ADR-0091). 'get' returns the scheduler's "
        "timings — summary_hour, due_soon_window_hours, reminder_cooldown_hours, "
        "backup_enabled, backup_hour, backup_keep — plus which auth mode and LLM provider "
        "are configured. 'bounds' returns each setting's legal min/max; call it before "
        "'update', because an out-of-range value is refused rather than clamped and an "
        "unknown key is refused rather than ignored. 'update' takes a partial dict of those "
        "settings and takes effect without a restart. 'ical_token' returns the calendar feed "
        "token and its subscribe path; 'rotate_ical_token' issues a new one and breaks every "
        "client already subscribed. Everything but 'get'/'bounds' needs an admin-scope key."
    )
)
async def manage_settings(action: SettingsAction, settings: dict | None = None) -> str:
    """settings is the partial dict of scheduler timings, required only for 'update'."""
    return await _manage_settings(action=action, settings=settings)


@mcp.tool(
    description=(
        "Take, inspect or restore a backup (ADR-0091). 'status' reports whether the daily "
        "backup is on, when it runs, how many are kept, and lists the archives on disk. "
        "'run' takes one now and prunes beyond backup_keep — the call to make before a bulk "
        "change you are unsure about. 'restore' replaces ALL data with an archive already on "
        "the server and is irreversible: it needs the filename from 'status' and "
        "confirm='replace'. Needs an admin-scope key. Downloading an archive is deliberately "
        "not a tool — it is the whole database, credentials included; use "
        "GET /api/v1/backup/export for that."
    )
)
async def manage_backup(action: BackupAction, filename: str | None = None, confirm: str = "") -> str:
    """filename and confirm='replace' are both required for 'restore'."""
    return await _manage_backup(action=action, filename=filename, confirm=confirm)


@mcp.tool(
    description=(
        "Everything needed to compose a workflow rule the engine will actually run: the "
        "legal triggers, which condition fields each trigger carries, condition operators, "
        "action types, and the legal values for each. Generated from the registries the "
        "write path enforces (ADR-0055, ADR-0056). Call this BEFORE create_workflow_rule — "
        "a guessed field name produces a rule that saves cleanly and never fires."
    )
)
async def get_rule_vocabulary(project_id: str | None = None) -> str:
    return await _get_rule_vocabulary(project_id=project_id)


@mcp.tool(
    description=(
        "List, read, create, update, delete or dry-run workflow rules — the platform's "
        "automation layer (ADR-0085). `config` for 'create' takes {name, trigger, actions[], "
        "conditions?, project_id?, active?}; see get_rule_vocabulary for the legal values. "
        "'test' needs node_id and reports whether the rule would fire and what each action "
        "would do, without writing anything. Rules never chain: writes a rule makes do not "
        "re-enter the engine."
    )
)
async def manage_workflow_rules(
    action: Literal["list", "get", "create", "update", "delete", "test"],
    rule_id: str | None = None,
    config: dict | None = None,
    project_id: str | None = None,
    node_id: str | None = None,
) -> str:
    return await _manage_workflow_rules(
        action=action, rule_id=rule_id, config=config, project_id=project_id, node_id=node_id
    )


@mcp.tool(
    description=(
        "List, upload or delete a task's file attachments (ADR-0086). This is where output "
        "you produced belongs — a build log, a report, a diff — rather than pasted into a "
        "comment where it cannot be downloaded. Upload takes the bytes base64-encoded in "
        "content_base64, max 20MB decoded."
    )
)
async def manage_attachments(
    action: Literal["list", "upload", "delete"],
    project_id: str,
    task_id: str,
    filename: str | None = None,
    content_base64: str | None = None,
    content_type: str | None = None,
    attachment_id: str | None = None,
) -> str:
    return await _manage_attachments(
        action=action,
        project_id=project_id,
        task_id=task_id,
        filename=filename,
        content_base64=content_base64,
        content_type=content_type,
        attachment_id=attachment_id,
    )


# ── MCP resources ────────────────────────────────────────────────────


@mcp.resource(
    "todo://summary",
    name="Platform Summary",
    description="Comprehensive summary of all projects, tasks, and recent activity",
    mime_type="application/json",
)
async def resource_summary() -> str:
    return _as_text(await _get("/summary"))


@mcp.resource(
    "todo://activity",
    name="Recent Activity",
    description="Recent activity log showing what changed and by whom",
    mime_type="application/json",
)
async def resource_activity() -> str:
    return _as_text(await _get("/activity", params={"limit": 50}))


@mcp.resource(
    "todo://notifications",
    name="Unread Notifications",
    description="Unread in-app notifications",
    mime_type="application/json",
)
async def resource_notifications() -> str:
    return _as_text(await _get("/notifications", params={"unread_only": "true", "limit": 50}))


@mcp.resource(
    "todo://agent-context",
    name="Agent Context",
    description="Platform capabilities, conventions, and agent instructions",
    mime_type="application/json",
)
async def resource_agent_context() -> str:
    return _as_text(await _get("/agent-context"))


@mcp.resource(
    "todo://projects/{project_id}",
    name="Project Detail",
    description="Full project detail including all tasks",
    mime_type="application/json",
)
async def resource_project(project_id: str) -> str:
    """A URI with a placeholder registers as a resource *template*; the SDK routes
    ``todo://projects/p1`` here with ``project_id="p1"`` instead of us parsing it."""
    return _as_text(await _get(f"/projects/{project_id}"))


# ── MCP prompts ──────────────────────────────────────────────────────


@mcp.prompt(
    name="plan-my-day",
    description="Review overdue and in-progress tasks, then suggest a prioritized plan for today",
)
def plan_my_day() -> str:
    return (
        "Please review my current tasks using the get_summary tool, "
        "then help me plan my day. Focus on:\n"
        "1. Overdue tasks that need immediate attention\n"
        "2. In-progress tasks I should continue\n"
        "3. High-priority todo tasks to start today\n"
        "4. Suggest a realistic schedule considering task dependencies\n\n"
        "Be specific about which tasks to tackle and in what order."
    )


@mcp.prompt(
    name="project-review",
    description="Summarize a project's current state, identify blockers, and suggest next actions",
)
def project_review(project_name: str) -> str:
    """project_name is the name or ID of the project to review."""
    return (
        f"Please review the project '{project_name}'. Use the search tool to find it, "
        "then list its tasks. Provide:\n"
        "1. Overall progress and health assessment\n"
        "2. Blocked or stalled tasks\n"
        "3. Overdue items\n"
        "4. Suggested next actions to move the project forward\n"
        "5. Any risks or concerns"
    )


@mcp.prompt(
    name="triage-inbox",
    description="Review all todo tasks and help prioritize them by urgency and importance",
)
def triage_inbox() -> str:
    return (
        "Please review all tasks with 'todo' status across all projects. "
        "Help me triage them by:\n"
        "1. Identifying tasks that should be high priority\n"
        "2. Grouping related tasks that could be batched\n"
        "3. Flagging tasks that are unclear and need more detail\n"
        "4. Suggesting which tasks to start next\n"
        "5. Identifying any tasks that might be obsolete"
    )


@mcp.prompt(
    name="weekly-summary",
    description="Generate a summary of accomplishments and progress from the past week",
)
def weekly_summary() -> str:
    return (
        "Please generate a weekly summary of my work. Use the get_activity tool "
        "with a limit of 200 to get recent activity, then:\n"
        "1. List tasks completed this week\n"
        "2. List tasks started or progressed\n"
        "3. Highlight any blockers encountered\n"
        "4. Calculate overall velocity (tasks done per day)\n"
        "5. Suggest focus areas for next week"
    )


# ── Transports ───────────────────────────────────────────────────────


class HttpTransport:
    """The HTTP transport: a bearer-guarded door, and the lifespan behind it.

    Mount it as a route endpoint and enter `lifespan()` — the same two steps for
    either host (ADR-0080). Three shapes here are load-bearing:

    **A class, not a function.** `starlette.routing.Route` decides what an endpoint
    is by asking `inspect.isfunction`: a function is called as
    ``func(request) -> response``, and only a non-function is treated as an ASGI
    app. The session manager writes its own response, so handed a function
    Starlette would wait for a `Response` that never comes.

    **A route, not a `Mount`.** ADR-0076 already paid for this: a `Mount` matches
    only ``/mcp/...`` and answers the client's exact ``/mcp`` with a 307, and **a
    redirect is not a transport**. The SDK's own middleware tier is not the place
    either — it runs per JSON-RPC message, after the request has been accepted.

    **A fresh transport app per startup.** The SDK's session manager may be run
    exactly once per instance, so one app built at import and re-entered breaks
    every startup after the first — which in a test suite is every test after the
    first, all at once and nowhere near the cause.
    """

    def __init__(self, token: str) -> None:
        self._token = token
        self._inner = None

    @asynccontextmanager
    async def lifespan(self) -> AsyncIterator[None]:
        """Start the session manager. A host that skips this serves a broken door."""
        inner = _build_transport_app()
        self._inner = inner
        try:
            async with inner.router.lifespan_context(inner):
                yield
        finally:
            self._inner = None

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            raise RuntimeError(
                f"HttpTransport is mounted on a route and only handles http scopes, got {scope['type']!r}"
            )
        # The scheme is required and compared case-insensitively (RFC 7235): a bare
        # token would be a second undocumented way in, and ``bearer`` is as valid as
        # ``Bearer``.
        request = Request(scope, receive)
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not secrets.compare_digest(token.strip(), self._token):
            await JSONResponse({"error": "Unauthorized"}, status_code=401)(scope, receive, send)
            return
        # Checked *after* the token on purpose: a misconfigured host is a fact about
        # this deployment, and an unauthenticated caller does not get to learn it.
        if self._inner is None:
            raise RuntimeError(
                "MCP transport reached with no session manager running: the host mounted "
                "the route but never entered HttpTransport.lifespan()."
            )
        await self._inner(scope, receive, send)


def _build_transport_app():
    """The SDK's Streamable HTTP app, one per startup.

    The SDK owns the transport now (ADR-0077): the hand-rolled ASGI endpoint, the
    session-manager lifespan and the exact-path routing that ADR-0076 had to get
    right by hand are all ``streamable_http_app()``. What stays ours is the door.
    """
    from starlette.middleware.cors import CORSMiddleware

    # ``host`` defaults to 127.0.0.1, and that default silently switches DNS-rebinding
    # protection *on* with an allow-list of localhost only — behind nginx every request
    # arrives with the public Host header and would be refused. Disabled explicitly
    # rather than by picking a host string that happens to miss that branch: this
    # endpoint is public by design, and the bearer token is what guards it.
    inner = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    inner.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return inner


def create_http_app() -> HttpTransport:
    """The transport, or a refusal to serve one unguarded."""
    # Mandatory, as in ADR-0076: over HTTP the endpoint is reachable by anyone who
    # can route to it, and every tool behind it carries the server's own API key.
    http_token = os.environ.get("MCP_HTTP_TOKEN", "")
    if not http_token:
        raise SystemExit(
            "MCP_HTTP_TOKEN is required for MCP_TRANSPORT=http: the HTTP endpoint "
            "exposes every tool to anyone who can reach it. Set a token, or use the "
            "default stdio transport, where the client owns the process."
        )
    return HttpTransport(http_token)


def mcp_route(transport: HttpTransport) -> Route:
    """The mount, defined once because its exact shape is the thing that matters.

    `HttpTransport`'s docstring argues at length that `Route` (not `Mount`) and an
    ASGI-app endpoint (not a function) are load-bearing. A shape worth that much
    explanation is worth having one definition: every host — the backend, the
    standalone app, and the tests that exist to catch a regression in this very
    shape — mounts through here, so none of them can drift from the others.
    """
    return Route("/mcp", endpoint=transport, methods=["GET", "POST", "DELETE"], name="mcp")


def create_standalone_app(transport: HttpTransport):
    """Host the transport in an app of its own — the same two steps the backend takes.

    Kept symmetric on purpose: whatever the backend has to do to mount this
    correctly, this path does too, so a mistake in either shows up in both.
    """
    from starlette.applications import Starlette

    return Starlette(routes=[mcp_route(transport)], lifespan=lambda _app: transport.lifespan())


if __name__ == "__main__":
    if os.environ.get("MCP_TRANSPORT", "stdio") == "http":
        import uvicorn

        port = int(os.environ.get("MCP_HTTP_PORT", "8001"))
        uvicorn.run(create_standalone_app(create_http_app()), host="0.0.0.0", port=port)
    else:
        asyncio.run(mcp.run_stdio_async())
