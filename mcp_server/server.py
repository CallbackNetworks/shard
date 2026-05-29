#!/usr/bin/env python3
"""MCP server exposing TODO Platform tools via stdio transport.

Proxies all operations through the backend HTTP API (/api/v1) to ensure
business logic (activity logging, notifications, workflow rules, WebSocket
broadcasts) is applied consistently.  See ADR-0005 for rationale.
"""

import asyncio
import json
import os

import httpx
import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

API_BASE_URL = os.environ.get("API_BASE_URL", "http://backend:8000")
API_KEY = os.environ.get("API_KEY", "")

server = Server("todo-platform")


def _api_url(path: str) -> str:
    return f"{API_BASE_URL}/api/v1{path}"


def _headers() -> dict:
    return {"X-API-Key": API_KEY, "Content-Type": "application/json"}


async def _get(path: str, params: dict | None = None) -> dict | list | str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(_api_url(path), headers=_headers(), params=params)
        if resp.status_code >= 400:
            return f"Error {resp.status_code}: {resp.text}"
        return resp.json()


async def _post(path: str, body: dict | list | None = None) -> dict | list | str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(_api_url(path), headers=_headers(), json=body)
        if resp.status_code >= 400:
            return f"Error {resp.status_code}: {resp.text}"
        if resp.status_code == 204:
            return {"status": "ok"}
        return resp.json()


async def _patch(path: str, body: dict | None = None) -> dict | list | str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(_api_url(path), headers=_headers(), json=body)
        if resp.status_code >= 400:
            return f"Error {resp.status_code}: {resp.text}"
        return resp.json()


async def _delete(path: str) -> dict | str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(_api_url(path), headers=_headers())
        if resp.status_code >= 400:
            return f"Error {resp.status_code}: {resp.text}"
        if resp.status_code == 204:
            return {"status": "deleted"}
        return resp.json()


# ── Tool implementations ────────────────────────────────────────────


async def _get_summary() -> str:
    result = await _get("/summary")
    return json.dumps(result) if not isinstance(result, str) else result


async def _list_tasks(project_id: str, status: str | None = None) -> str:
    params = {}
    if status:
        params["status_filter"] = status
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
    result = await _post(f"/projects/{project_id}/tasks", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _update_task(project_id: str, task_id: str, **kwargs) -> str:
    body = {k: v for k, v in kwargs.items() if v is not None}
    if not body:
        return "No fields to update"
    result = await _patch(f"/projects/{project_id}/tasks/{task_id}", body)
    return json.dumps(result) if not isinstance(result, str) else result


async def _create_subtask(
    project_id: str, parent_task_id: str, title: str, priority: str = "medium"
) -> str:
    body = {"title": title, "priority": priority, "parent_id": parent_task_id}
    result = await _post(f"/projects/{project_id}/tasks", body)
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
        result = await _post(
            f"/projects/{project_id}/tasks/{task_id}/labels/{label_id}"
        )
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "remove":
        if not project_id or not task_id or not label_id:
            return "project_id, task_id, and label_id required for remove action"
        result = await _delete(
            f"/projects/{project_id}/tasks/{task_id}/labels/{label_id}"
        )
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


async def _add_comment(
    project_id: str, task_id: str, body: str, author: str | None = None
) -> str:
    payload: dict = {"body": body}
    if author:
        payload["author"] = author
    result = await _post(
        f"/projects/{project_id}/tasks/{task_id}/comments", payload
    )
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
        result = await _get(
            f"/projects/{project_id}/tasks/{task_id}/dependencies"
        )
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "add":
        if not depends_on_id:
            return "depends_on_id required for add action"
        result = await _post(
            f"/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}"
        )
        return json.dumps(result) if not isinstance(result, str) else result

    if action == "remove":
        if not depends_on_id:
            return "depends_on_id required for remove action"
        result = await _delete(
            f"/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}"
        )
        return json.dumps(result) if not isinstance(result, str) else result

    return f"Unknown dependency action: {action}"


async def _get_notifications(unread_only: bool = True, limit: int = 20) -> str:
    params = {"unread_only": str(unread_only).lower(), "limit": limit}
    result = await _get("/notifications", params=params)
    return json.dumps(result) if not isinstance(result, str) else result


# ── MCP tool registry ────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    types.Tool(
        name="get_summary",
        description=(
            "Get a comprehensive summary of the entire platform: project stats, "
            "identity breakdown, active/overdue tasks, and recent activity. "
            "This is the best starting point for understanding current state."
        ),
        inputSchema={"type": "object", "properties": {}, "required": []},
    ),
    types.Tool(
        name="list_tasks",
        description="List tasks for a project, optionally filtered by status.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID (required)"},
                "status": {
                    "type": "string",
                    "enum": ["todo", "in_progress", "done", "failed"],
                    "description": "Filter by status",
                },
            },
            "required": ["project_id"],
        },
    ),
    types.Tool(
        name="create_task",
        description="Create a new task in a project.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID (required)"},
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                "description": {"type": "string"},
                "assignee": {"type": "string"},
                "due_date": {"type": "string", "description": "YYYY-MM-DD"},
            },
            "required": ["project_id", "title"],
        },
    ),
    types.Tool(
        name="update_task",
        description="Update task fields: status, priority, title, description, assignee, due_date, time_estimate, time_spent.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID (required)"},
                "task_id": {"type": "string", "description": "Task ID (required)"},
                "status": {"type": "string", "enum": ["todo", "in_progress", "done", "failed"]},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "assignee": {"type": "string"},
                "due_date": {"type": "string", "description": "YYYY-MM-DD or null to clear"},
                "time_estimate": {"type": "integer", "description": "Estimated minutes"},
                "time_spent": {"type": "integer", "description": "Minutes spent"},
            },
            "required": ["project_id", "task_id"],
        },
    ),
    types.Tool(
        name="create_subtask",
        description="Create a subtask under an existing task.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID (required)"},
                "parent_task_id": {"type": "string", "description": "Parent task ID (required)"},
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": ["project_id", "parent_task_id", "title"],
        },
    ),
    types.Tool(
        name="manage_labels",
        description="Add or remove a label from a task, or list labels for a project.",
        inputSchema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "project_id": {"type": "string", "description": "Required for all actions"},
                "task_id": {"type": "string", "description": "Required for add/remove"},
                "label_id": {"type": "string", "description": "Required for add/remove"},
            },
            "required": ["action", "project_id"],
        },
    ),
    types.Tool(
        name="analyze_workload",
        description="Analyze workload: tasks by status, priority, overdue count. Pass project_id for per-project stats, omit for platform overview.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Optional; platform overview if omitted"},
            },
            "required": [],
        },
    ),
    types.Tool(
        name="search",
        description="Search for tasks and projects by keyword (searches titles and descriptions).",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
            },
            "required": ["query"],
        },
    ),
    types.Tool(
        name="get_activity",
        description="Get recent activity log entries showing what changed and who did it.",
        inputSchema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of entries (default 20, max 200)"},
            },
            "required": [],
        },
    ),
    types.Tool(
        name="add_comment",
        description="Add a comment to a task. Useful for leaving notes, progress updates, or context.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "body": {"type": "string", "description": "Comment text (markdown supported)"},
                "author": {"type": "string", "description": "Author name (optional, defaults to API key name)"},
            },
            "required": ["project_id", "task_id", "body"],
        },
    ),
    types.Tool(
        name="list_comments",
        description="List all comments on a task in chronological order.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
            },
            "required": ["project_id", "task_id"],
        },
    ),
    types.Tool(
        name="manage_dependencies",
        description="View, add, or remove task dependencies (blocker relationships).",
        inputSchema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "add", "remove"],
                    "description": "list: view blockers/dependents; add/remove: manage a specific dependency",
                },
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "depends_on_id": {"type": "string", "description": "ID of the blocking task (required for add/remove)"},
            },
            "required": ["action", "project_id", "task_id"],
        },
    ),
    types.Tool(
        name="get_notifications",
        description="Get in-app notifications. Useful for checking what events occurred recently.",
        inputSchema={
            "type": "object",
            "properties": {
                "unread_only": {"type": "boolean", "description": "Only show unread notifications (default true)"},
                "limit": {"type": "integer", "description": "Max notifications to return (default 20)"},
            },
            "required": [],
        },
    ),
]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return TOOL_DEFINITIONS


@server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> list[types.TextContent]:
    args = arguments or {}
    try:
        if name == "get_summary":
            result = await _get_summary()
        elif name == "list_tasks":
            result = await _list_tasks(args["project_id"], args.get("status"))
        elif name == "create_task":
            result = await _create_task(
                project_id=args["project_id"],
                title=args["title"],
                priority=args.get("priority", "medium"),
                description=args.get("description"),
                assignee=args.get("assignee"),
                due_date=args.get("due_date"),
            )
        elif name == "update_task":
            pid = args.pop("project_id")
            tid = args.pop("task_id")
            result = await _update_task(pid, tid, **args)
        elif name == "create_subtask":
            result = await _create_subtask(
                project_id=args["project_id"],
                parent_task_id=args["parent_task_id"],
                title=args["title"],
                priority=args.get("priority", "medium"),
            )
        elif name == "manage_labels":
            result = await _manage_labels(
                action=args["action"],
                project_id=args.get("project_id"),
                task_id=args.get("task_id"),
                label_id=args.get("label_id"),
            )
        elif name == "analyze_workload":
            result = await _analyze_workload(args.get("project_id"))
        elif name == "search":
            result = await _search(args.get("query", ""))
        elif name == "get_activity":
            result = await _get_activity(args.get("limit", 20))
        elif name == "add_comment":
            result = await _add_comment(
                project_id=args["project_id"],
                task_id=args["task_id"],
                body=args["body"],
                author=args.get("author"),
            )
        elif name == "list_comments":
            result = await _list_comments(args["project_id"], args["task_id"])
        elif name == "manage_dependencies":
            result = await _manage_dependencies(
                action=args["action"],
                project_id=args["project_id"],
                task_id=args["task_id"],
                depends_on_id=args.get("depends_on_id"),
            )
        elif name == "get_notifications":
            result = await _get_notifications(
                unread_only=args.get("unread_only", True),
                limit=args.get("limit", 20),
            )
        else:
            result = f"Unknown tool: {name}"
    except Exception as exc:
        result = f"Tool error: {exc}"

    return [types.TextContent(type="text", text=result)]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
