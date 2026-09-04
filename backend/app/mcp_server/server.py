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
SettingsAction = Literal["get", "bounds", "update", "llm_update", "ical_token", "rotate_ical_token"]
BackupAction = Literal["status", "run", "restore"]
ImportSource = Literal["github", "linear", "trello"]
UnfiledAction = Literal["list", "file"]
DecisionLinkAction = Literal["supersede", "unsupersede", "governing"]
CrudAction = Literal["create", "update", "delete"]
CycleAction = Literal["list", "get", "compare", "duplicate"]
RecurrenceAction = Literal["get", "create", "update", "delete"]
TemplateAction = Literal["list", "create", "update", "delete"]
ShareAction = Literal["rotate_token", "set_pin", "clear_pin", "set_expiry", "set_guest_notes", "views", "chat_log"]
NotificationAction = Literal["unread_count", "read", "read_all", "delete"]
TransferAction = Literal["export", "import"]
EmailAction = Literal["status", "send"]
AnalyticsReport = Literal[
    "burndown",
    "cycle_burndown",
    "velocity",
    "heatmap",
    "status_trend",
    "critical_path",
    "estimation_calibration",
    "estimate_suggestion",
]

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


async def _get_text(path: str) -> str:
    """For the endpoints whose body is a document, not JSON (the decision export)."""
    client = _get_client()
    resp = await client.get(path)
    if resp.status_code >= 400:
        return f"Error {resp.status_code}: {resp.text}"
    return resp.text


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


async def _get_container_subtree(node_id: str, view: str = "containers") -> str:
    # The two halves of a container's children have one endpoint each (ADR-0065): the child
    # containers with their own rollups, or the board of tasks living directly in it.
    path = "contained-tasks" if view == "tasks" else "subtree"
    result = await _get(f"/nodes/{node_id}/{path}")
    return json.dumps(result) if not isinstance(result, str) else result


async def _bulk_update_tasks(project_id: str, updates: list[dict]) -> str:
    result = await _post(f"/projects/{project_id}/tasks/bulk-update", updates)
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_node_types() -> str:
    result = await _get("/node-types")
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_types(kind: str, action: str, key: str | None = None, config: dict | None = None) -> str:
    base = "/node-types" if kind == "node" else "/edge-types"
    if action == "create":
        if not config or not config.get("key") or not config.get("label"):
            return "Error: config with at least key and label is required to create a type"
        result = await _post(base, config)
    elif action == "update":
        if not key or not config:
            return "Error: key and config are required to update a type"
        result = await _patch(f"{base}/{key}", config)
    elif action == "delete":
        if not key:
            return "Error: key is required to delete a type"
        result = await _delete(f"{base}/{key}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_edge_types(for_type: str | None = None) -> str:
    # Narrowed by node type this answers the question a caller writing an edge actually
    # has — given this node, what can I link it to, and which way round (ADR-0150) —
    # rather than the whole vocabulary it then has to apply itself.
    result = await _get(f"/edge-types/options/{for_type}" if for_type else "/edge-types")
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
    elif action == "sources":
        result = await _get("/integrations/sources")
    elif action == "templates":
        result = await _get(
            f"/integrations/templates/{integration_id}" if integration_id else "/integrations/templates"
        )
    elif action == "health":
        if not integration_id:
            return "Error: integration_id is required to read health"
        result = await _get(f"/integrations/{integration_id}/health")
    elif action == "retry_all":
        if not integration_id:
            return "Error: integration_id is required to retry every failed delivery"
        result = await _post(f"/integrations/{integration_id}/retry-all")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_deliveries(
    integration_id: str | None = None,
    status: str | None = None,
    limit: int = 20,
    delivery_id: str | None = None,
) -> str:
    if delivery_id:
        result = await _get(f"/deliveries/{delivery_id}")
        return json.dumps(result) if not isinstance(result, str) else result
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
    elif action == "llm_update":
        if not settings:
            return "Error: settings is required to update"
        result = await _put("/settings/llm", settings)
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


async def _import_tasks(project_id: str, source: str, payload: dict) -> str:
    if source not in ("github", "linear", "trello"):
        return f"Error: unknown source '{source}'"
    result = await _post(f"/projects/{project_id}/import/{source}", payload)
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_external_issue(project_id: str, task_id: str, provider: str | None = None) -> str:
    body = {"provider": provider} if provider else {}
    result = await _post(f"/projects/{project_id}/tasks/{task_id}/create-external-issue", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_unfiled(action: str, task_id: str | None = None, project_id: str | None = None) -> str:
    if action == "list":
        result = await _get("/tasks/unfiled")
    elif action == "file":
        if not task_id or not project_id:
            return "Error: task_id and project_id are required to file a task"
        result = await _post(f"/tasks/{task_id}/memberships/{project_id}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_decisions(project_id: str | None = None, status: str | None = None) -> str:
    params = {k: v for k, v in {"project_id": project_id, "status": status}.items() if v}
    result = await _get("/decisions", params=params or None)
    return json.dumps(result) if not isinstance(result, str) else result


async def _export_decision(decision_id: str) -> str:
    return await _get_text(f"/decisions/{decision_id}/export")


async def _manage_decision_links(
    action: str,
    decision_id: str | None = None,
    superseded_id: str | None = None,
    node_id: str | None = None,
) -> str:
    """The relations a decision record carries (ADR-0118).

    Arguments are checked here rather than round-tripping a request the server would only
    refuse (ADR-0093): a missing id is a mistake the caller can fix without the network.
    """
    if action == "governing":
        if not node_id:
            return "Error: node_id is required to list the decisions governing a node"
        result = await _get(f"/nodes/{node_id}/decisions")
    elif action in ("supersede", "unsupersede"):
        if not decision_id or not superseded_id:
            return f"Error: decision_id and superseded_id are required to {action}"
        path = f"/decisions/{decision_id}/supersedes/{superseded_id}"
        result = await (_post(path) if action == "supersede" else _delete(path))
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_cycles(
    action: str,
    project_id: str,
    cycle_id: str | None = None,
    compare_with: str | None = None,
) -> str:
    base = f"/projects/{project_id}/cycles"
    if action == "list":
        result = await _get(base)
    elif action == "get":
        if not cycle_id:
            return "Error: cycle_id is required"
        result = await _get(f"{base}/{cycle_id}")
    elif action == "compare":
        if not cycle_id or not compare_with:
            return "Error: cycle_id and compare_with are required to compare cycles"
        result = await _get(f"{base}/{cycle_id}/compare", params={"compare_with": compare_with})
    elif action == "duplicate":
        if not cycle_id:
            return "Error: cycle_id is required"
        result = await _post(f"{base}/{cycle_id}/duplicate")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


# One tool over eight reports, because they answer one question — "how is this going?" —
# and eight tool names would crowd the menu the model actually reads.
_ANALYTICS_PATHS = {
    "burndown": "/analytics/burndown",
    "cycle_burndown": "/analytics/cycle-burndown",
    "velocity": "/analytics/velocity",
    "heatmap": "/analytics/heatmap",
    "status_trend": "/analytics/status-trend",
    "estimation_calibration": "/analytics/estimation-calibration",
    "estimate_suggestion": "/analytics/estimate-suggestion",
}


async def _get_analytics(
    report: str,
    project_id: str | None = None,
    cycle_id: str | None = None,
    days: int | None = None,
    raw_estimate: int | None = None,
) -> str:
    if report == "critical_path":
        if not project_id:
            return "Error: project_id is required for the critical path"
        result = await _get(f"/analytics/critical-path/{project_id}")
        return json.dumps(result) if not isinstance(result, str) else result

    path = _ANALYTICS_PATHS.get(report)
    if not path:
        return f"Error: unknown report '{report}'"
    if report in ("burndown", "cycle_burndown") and not cycle_id:
        return f"Error: cycle_id is required for the {report} report"
    if report == "estimate_suggestion" and raw_estimate is None:
        return "Error: raw_estimate is required for the estimate_suggestion report"

    params = {
        k: v
        for k, v in {
            "project_id": project_id,
            "cycle_id": cycle_id,
            "days": days,
            "raw_estimate": raw_estimate,
        }.items()
        if v is not None
    }
    result = await _get(path, params=params or None)
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_recurrence(action: str, project_id: str, task_id: str, config: dict | None = None) -> str:
    path = f"/projects/{project_id}/tasks/{task_id}/recurrence"
    if action == "get":
        result = await _get(path)
    elif action == "create":
        if not config:
            return "Error: config is required to create a recurrence rule"
        result = await _post(path, config)
    elif action == "update":
        if not config:
            return "Error: config is required to update a recurrence rule"
        result = await _patch(path, config)
    elif action == "delete":
        result = await _delete(path)
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_templates(
    action: str, template_id: str | None = None, config: dict | None = None, project_id: str | None = None
) -> str:
    if action == "list":
        result = await _get("/templates", params={"project_id": project_id} if project_id else None)
    elif action == "create":
        if not config:
            return "Error: config is required to create a template"
        result = await _post("/templates", config)
    elif action == "update":
        if not template_id or not config:
            return "Error: template_id and config are required to update a template"
        result = await _patch(f"/templates/{template_id}", config)
    elif action == "delete":
        if not template_id:
            return "Error: template_id is required to delete a template"
        result = await _delete(f"/templates/{template_id}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_share(action: str, node_id: str, config: dict | None = None) -> str:
    base = f"/nodes/{node_id}/share"
    cfg = config or {}
    if action == "rotate_token":
        result = await _post(f"{base}/rotate-token")
    elif action == "set_pin":
        if not cfg.get("pin"):
            return "Error: config {'pin': '...'} is required to set a PIN"
        result = await _post(f"{base}/set-pin", cfg)
    elif action == "clear_pin":
        result = await _delete(f"{base}/pin")
    elif action == "set_expiry":
        # An explicit null clears the expiry, so the key must be present either way.
        result = await _post(f"{base}/set-expiry", {"expires_at": cfg.get("expires_at")})
    elif action == "set_guest_notes":
        if "allowed" not in cfg:
            return "Error: config {'allowed': true|false} is required"
        result = await _post(f"{base}/set-guest-notes", {"allowed": bool(cfg["allowed"])})
    elif action == "views":
        result = await _get(f"/nodes/{node_id}/share-views")
    elif action == "chat_log":
        result = await _get(f"/nodes/{node_id}/share-chat-log")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_notifications(action: str, notification_id: str | None = None) -> str:
    if action == "unread_count":
        result = await _get("/notifications/unread-count")
    elif action == "read":
        if not notification_id:
            return "Error: notification_id is required to mark one read"
        result = await _patch(f"/notifications/{notification_id}/read")
    elif action == "read_all":
        result = await _post("/notifications/mark-all-read")
    elif action == "delete":
        if not notification_id:
            return "Error: notification_id is required to delete one"
        result = await _delete(f"/notifications/{notification_id}")
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _transfer_tasks(action: str, project_id: str, tasks: list[dict] | None = None) -> str:
    if action == "export":
        result = await _get(f"/projects/{project_id}/tasks/export")
    elif action == "import":
        if tasks is None:
            return "Error: tasks is required to import"
        result = await _post(f"/projects/{project_id}/tasks/import", {"tasks": tasks})
    else:
        return f"Error: unknown action '{action}'"
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_graph_map(types: str | None = None, include: str | None = None, limit: int | None = None) -> str:
    params = {k: v for k, v in {"types": types, "include": include, "limit": limit}.items() if v is not None}
    result = await _get("/graph/map", params=params or None)
    return json.dumps(result) if not isinstance(result, str) else result


async def _get_ancestry(node_ids: list[str]) -> str:
    result = await _get("/graph/ancestry", params={"ids": ",".join(node_ids)})
    return json.dumps(result) if not isinstance(result, str) else result


async def _manage_email(action: str, to: list[str] | None = None, subject: str = "", body: str = "") -> str:
    if action == "status":
        result = await _get("/email/status")
    elif action == "send":
        if not to or not subject or not body:
            return "Error: to, subject and body are all required to send"
        result = await _post("/email/send", {"to": to, "subject": subject, "body": body})
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
        "get_project_detail only show a container's own tasks, not nested containers. "
        "view='tasks' returns the other half instead — the board of tasks living directly "
        "in this container, without descending (ADR-0065)."
    )
)
async def get_container_subtree(node_id: str, view: Literal["containers", "tasks"] = "containers") -> str:
    """node_id is a project, goal or custom container."""
    return await _get_container_subtree(node_id=node_id, view=view)


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
        "Create, update or delete a node or edge type — the registry other data is shaped "
        "by, so this needs an admin key (ADR-0079). kind='node' registers a layer: config "
        "{key, label, roles?: ['container'|'task'], fields?: [{key,label,kind,store}], "
        "icon?, color?}. kind='edge' registers a relation: config {key, label, description?, "
        "allowed_source?, allowed_target?} where each end is {types:[...]} or {roles:[...]} "
        "and omitting it means unconstrained — a relation with no endpoint declarations is "
        "the state ADR-0078 exists to prevent, so declare them. Built-in types cannot be "
        "deleted and a type in use cannot be deleted. Check list_node_types / "
        "list_edge_types first; creating a type is rare."
    )
)
async def manage_types(
    kind: Literal["node", "edge"],
    action: CrudAction,
    key: str | None = None,
    config: dict | None = None,
) -> str:
    """key identifies an existing type for update/delete; for create it goes inside config."""
    return await _manage_types(kind=kind, action=action, key=key, config=config)


@mcp.tool(
    description=(
        "List the relation vocabulary: every edge type, what it means, and which node "
        "types/roles may sit at each end. Call this before manage_edges — the endpoint "
        "rules are enforced on write, so an edge with the wrong relation is refused. "
        "Pass for_type (a node type key) to get only the relations a node of that type "
        "can actually be an end of, each with a 'direction': 'outgoing' means write "
        "this -> other, 'incoming' means write other -> this. Most relations are legal "
        "in one direction only, and picking the wrong way round is the common mistake "
        "'contains' does not refuse."
    )
)
async def list_edge_types(for_type: str | None = None) -> str:
    """Omit for_type for the whole vocabulary; pass one to narrow it to that node type."""
    return await _list_edge_types(for_type=for_type)


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
        "means unchanged, not deleted (ADR-0063). Reads that describe the surface rather "
        "than one integration: 'events' (deliverable event names), 'sources' (causes an "
        "integration can narrow to), 'templates' (ready-made configs for common CI/CD "
        "platforms; pass integration_id to fetch one by template id), 'health' (delivery "
        "success rate for one integration) and 'retry_all' (re-send every failed delivery "
        "for one integration)."
    )
)
async def manage_integration(
    action: Literal["create", "update", "delete", "test", "events", "sources", "templates", "health", "retry_all"],
    integration_id: str | None = None,
    config: dict | None = None,
) -> str:
    return await _manage_integration(action=action, integration_id=integration_id, config=config)


@mcp.tool(
    description=(
        "List outbound webhook delivery attempts, newest first, with the response the target "
        "gave and the next scheduled retry. The failure mode of a webhook is silence, so "
        "this is how you find out yours is not arriving. Filter by integration_id or status "
        "(pending/success/failed/dead), or pass delivery_id to fetch one attempt in full — "
        "with the request headers redacted, since a delivery log is a second path out for a "
        "credential (ADR-0085)."
    )
)
async def list_deliveries(
    integration_id: str | None = None,
    status: str | None = None,
    limit: int = 20,
    delivery_id: str | None = None,
) -> str:
    return await _list_deliveries(integration_id=integration_id, status=status, limit=limit, delivery_id=delivery_id)


@mcp.tool(description="Retry one failed or dead webhook delivery. The retry backoff starts over.")
async def retry_delivery(delivery_id: str) -> str:
    return await _retry_delivery(delivery_id=delivery_id)


@mcp.tool(
    description=(
        "Read or change how this instance behaves (ADR-0091, ADR-0096, ADR-0097). 'get' "
        "returns the scheduler's timings — summary_hour, due_soon_window_hours, "
        "reminder_cooldown_hours, backup_enabled, backup_hour, backup_keep — plus "
        "llm_provider, llm_model, llm_base_url and llm_api_key_configured (never the key "
        "itself), auth mode and whether SMTP is set up. 'bounds' returns each scheduler "
        "setting's legal min/max; call it before 'update', because an out-of-range value is "
        "refused rather than clamped and an unknown key is refused rather than ignored. "
        "'update' takes a partial dict of those scheduler settings and takes effect without "
        "a restart. 'llm_update' takes a partial dict of {provider: claude|openai|stub, "
        "model, api_key, base_url} for the assistant; provider is a wire protocol not a "
        "vendor, so a Cloudflare AI Gateway or self-hosted OpenAI-compatible endpoint is "
        "provider='openai' plus its own base_url. A field left out is unchanged, and \"\" "
        "clears that field back to its environment default — also no restart. When 'model' "
        "is included, the response carries a best-effort model_check against the provider's "
        "own model list; checked:false means no verdict was reachable, not that the model is "
        "wrong, and never blocks the write. 'ical_token' returns the calendar feed token and "
        "its subscribe path; 'rotate_ical_token' issues a new one and breaks every client "
        "already subscribed. Everything but 'get'/'bounds' needs an admin-scope key."
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
        "Import a batch of issues or cards as tasks (ADR-0092). `payload` is the source's "
        "own shape: github {issues:[{number,title,body,state,html_url,labels:[{name}],"
        "assignee:{login}}]}, linear {issues:[{title,description,state,priority,assignee,"
        "labels:[]}]}, trello {cards:[{name,desc,closed,due,labels:[{name}]}]}. Labels are "
        "matched by name in the project and created if missing; a closed issue or card "
        "becomes a done task. Partial success is the contract: the result is "
        "{imported, skipped, errors[]}, so one malformed row does not abandon the batch."
    )
)
async def import_tasks(project_id: str, source: ImportSource, payload: dict) -> str:
    """payload is the raw export from the source tool, not a normalised shape."""
    return await _import_tasks(project_id=project_id, source=source, payload=payload)


@mcp.tool(
    description=(
        "Publish a task as a new GitHub or GitLab issue and link the two (ADR-0092). The "
        "task stays the source of truth and the usual two-way sync takes over afterwards. "
        "Needs an active issue_sync integration with a token and a repo URL on the project. "
        "provider is detected from the repo URL; pass it only when that is ambiguous. A task "
        "already linked to an issue is refused."
    )
)
async def create_external_issue(project_id: str, task_id: str, provider: str | None = None) -> str:
    return await _create_external_issue(project_id=project_id, task_id=task_id, provider=provider)


@mcp.tool(
    description=(
        "List or file the unfiled bucket (ADR-0092): tasks that belong to no project at all. "
        "Listing tasks by project cannot show these by definition, so this is the inbox the "
        "triage-inbox prompt is about. 'file' gives a task its first project — it needs both "
        "task_id and project_id, is idempotent, and a task may belong to several projects."
    )
)
async def manage_unfiled(action: UnfiledAction, task_id: str | None = None, project_id: str | None = None) -> str:
    return await _manage_unfiled(action=action, task_id=task_id, project_id=project_id)


@mcp.tool(
    description=(
        "List decision records — what was decided about the work, its status "
        "(proposed/accepted/deprecated/superseded), what each one supersedes and is "
        "superseded by, and the work each governs. Read this before proposing a decision "
        "somebody already made, and read the supersession chain before treating an old one "
        "as current. Writing one is create_node with type='decision' and the state in "
        "status= (ADR-0118, ADR-0130). Both older shapes — a label carrying "
        "data.type='decision', and data.decision_status on a decision — are refused with a "
        "422 naming this one, because each used to be accepted and land where nothing reads."
    )
)
async def list_decisions(project_id: str | None = None, status: str | None = None) -> str:
    return await _list_decisions(project_id=project_id, status=status)


@mcp.tool(
    description=(
        "The relations a decision record carries. 'supersede' records that decision_id "
        "replaces superseded_id and marks the older one superseded — one act, because a "
        "record saying it was replaced with nothing naming the replacement is a dead end. "
        "'unsupersede' withdraws that. 'governing' lists the decisions attached to a task "
        "or container, i.e. what was decided about this piece of work. Attaching a decision "
        "to work is manage_edges with rel_type='governs', source=decision, target=work."
    )
)
async def manage_decision_links(
    action: DecisionLinkAction,
    decision_id: str | None = None,
    superseded_id: str | None = None,
    node_id: str | None = None,
) -> str:
    return await _manage_decision_links(
        action=action, decision_id=decision_id, superseded_id=superseded_id, node_id=node_id
    )


@mcp.tool(
    description=(
        "One decision record as a Markdown document under Status / Date / body headings, "
        "ready to commit to a docs directory."
    )
)
async def export_decision(decision_id: str) -> str:
    return await _export_decision(decision_id=decision_id)


@mcp.tool(
    description=(
        "Read and roll over cycles (sprints). 'list'/'get' return a cycle with its task ids "
        "and done count; 'compare' puts two side by side — task counts, completion rates, "
        "estimate vs actual — which is how you tell whether a sprint went better than the "
        "last one. 'duplicate' rolls a cycle over: a draft cycle holding fresh todo copies "
        "of every task in the source, carrying title, description, priority, assignee and "
        "estimate but not status or time spent, because what is copied is the intent to do "
        "the work, not the record of having done it. Cycle *membership* is an edge — use "
        "manage_edges with rel_type='in_cycle' to put a task into one."
    )
)
async def manage_cycles(
    action: CycleAction,
    project_id: str,
    cycle_id: str | None = None,
    compare_with: str | None = None,
) -> str:
    return await _manage_cycles(action=action, project_id=project_id, cycle_id=cycle_id, compare_with=compare_with)


@mcp.tool(
    description=(
        "One planning report at a time (ADR-0093). 'burndown'/'cycle_burndown' need "
        "cycle_id; 'velocity' is throughput per cycle; 'heatmap' is completions per day; "
        "'status_trend' takes days; 'critical_path' needs project_id and returns the "
        "dependency chain that decides the finish date; 'estimation_calibration' compares "
        "past estimates against actuals; 'estimate_suggestion' takes raw_estimate and "
        "corrects it by that history. analyze_workload answers 'what is the state of "
        "things' — this answers 'how is it trending, and what will it take'."
    )
)
async def get_analytics(
    report: AnalyticsReport,
    project_id: str | None = None,
    cycle_id: str | None = None,
    days: int | None = None,
    raw_estimate: int | None = None,
) -> str:
    """Which of project_id / cycle_id / raw_estimate is required depends on the report."""
    return await _get_analytics(
        report=report, project_id=project_id, cycle_id=cycle_id, days=days, raw_estimate=raw_estimate
    )


@mcp.tool(
    description=(
        "Read or set a task's recurrence (ADR-0093). config for create/update: "
        "{frequency: daily|weekly|monthly, next_run_at: ISO timestamp, interval_value?: int, "
        "day_of_week?: 0-6, day_of_month?: 1-31, end_date?: ISO, active?: bool}. The "
        "scheduler generates the next task from this rule, so a wrong next_run_at is the "
        "difference between a task appearing tomorrow and never. A task has at most one "
        "rule; 'create' on a task that has one replaces it."
    )
)
async def manage_recurrence(action: RecurrenceAction, project_id: str, task_id: str, config: dict | None = None) -> str:
    return await _manage_recurrence(action=action, project_id=project_id, task_id=task_id, config=config)


@mcp.tool(
    description=(
        "List, create, update or delete task templates (ADR-0093). config for create: "
        "{name, description?, priority?, subtasks?: [str], label_names?: [str], "
        "project_id?}. A template with no project_id is global. This is how a repeated "
        "piece of work stops being retyped — define the shape once, instantiate it later."
    )
)
async def manage_templates(
    action: TemplateAction,
    template_id: str | None = None,
    config: dict | None = None,
    project_id: str | None = None,
) -> str:
    return await _manage_templates(action=action, template_id=template_id, config=config, project_id=project_id)


@mcp.tool(
    description=(
        "Configure a node's public share page (ADR-0093). 'rotate_token' issues a new "
        "public URL and breaks the old link immediately — it needs an admin key, because "
        "the token *is* the URL (ADR-0087). 'set_pin' takes config {pin: '1234'} and "
        "'clear_pin' removes it; 'set_expiry' takes {expires_at: ISO or null} where null "
        "means never; 'set_guest_notes' takes {allowed: bool} for whether visitors may "
        "leave notes; 'views' reports how many times the page has been opened; 'chat_log' "
        "returns what visitors asked the page's read-only Q&A assistant (ADR-0098). The "
        "share token itself is only returned to an admin key."
    )
)
async def manage_share(action: ShareAction, node_id: str, config: dict | None = None) -> str:
    """node_id is any shareable node — a project, an identity or a custom container."""
    return await _manage_share(action=action, node_id=node_id, config=config)


@mcp.tool(
    description=(
        "Act on notifications (ADR-0093): 'unread_count', 'read' one, 'read_all', or "
        "'delete' one. Reading the list itself is get_notifications — this is the half that "
        "was missing, so an agent could see a notification and never clear it."
    )
)
async def manage_notifications(action: NotificationAction, notification_id: str | None = None) -> str:
    return await _manage_notifications(action=action, notification_id=notification_id)


@mcp.tool(
    description=(
        "Export a project's tasks as JSON, or import a batch back (ADR-0093). Unlike "
        "import_tasks, which speaks Trello/Linear/GitHub, this is the platform's own shape "
        "and round-trips: what export gives you is what import takes. Use it to move work "
        "between projects or to snapshot a project's tasks before restructuring them."
    )
)
async def transfer_tasks(action: TransferAction, project_id: str, tasks: list[dict] | None = None) -> str:
    """tasks is the list from a previous export; required only for 'import'."""
    return await _transfer_tasks(action=action, project_id=project_id, tasks=tasks)


@mcp.tool(
    description=(
        "The whole graph in one call — nodes and the edges between them (ADR-0093). Narrow "
        "with types (comma-separated node types) and limit. This is the orientation call: "
        "it shows which containers exist and how they nest, which listing projects cannot, "
        "because a custom layer above or below a project is invisible to a project list."
    )
)
async def get_graph_map(types: str | None = None, include: str | None = None, limit: int | None = None) -> str:
    return await _get_graph_map(types=types, include=include, limit=limit)


@mcp.tool(
    description=(
        "Where these nodes live and whose they are (ADR-0094). For each id: 'trails' are the "
        "'contains' paths above it, root-first — several when a node has several parents — and "
        "'owners' are the identities that own it. Ask this before reporting on a project: the "
        "project list says nothing about the identity or organization it sits under."
    )
)
async def get_ancestry(node_ids: list[str]) -> str:
    return await _get_ancestry(node_ids=node_ids)


@mcp.tool(
    description=(
        "Check whether outbound email is configured, or send a message (ADR-0093). 'send' "
        "needs to (a list of addresses), subject and body, and goes out through the same "
        "SMTP settings the daily summary uses — so 'status' returning unconfigured is why a "
        "send would fail. This actually sends mail; it is not a draft."
    )
)
async def manage_email(action: EmailAction, to: list[str] | None = None, subject: str = "", body: str = "") -> str:
    return await _manage_email(action=action, to=to, subject=subject, body=body)


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
