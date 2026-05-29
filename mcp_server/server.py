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
    result = await _post(
        f"/projects/{project_id}/tasks/{task_id}/progress", body
    )
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
    types.Tool(
        name="get_agent_context",
        description=(
            "Get platform onboarding context: capabilities, conventions, per-project "
            "agent instructions, and a quick-start guide. Call this first to understand "
            "how to interact with the platform."
        ),
        inputSchema={"type": "object", "properties": {}, "required": []},
    ),
    types.Tool(
        name="report_progress",
        description="Report intermediate progress on a task. Updates progress percentage, agent notes, and optionally adds a comment.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "progress_pct": {"type": "integer", "description": "Progress percentage 0-100"},
                "agent_notes": {"type": "string", "description": "Agent status notes (markdown)"},
                "comment": {"type": "string", "description": "Optional comment to add to the task"},
            },
            "required": ["project_id", "task_id"],
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
        elif name == "get_agent_context":
            result = await _get_agent_context()
        elif name == "report_progress":
            result = await _report_progress(
                project_id=args["project_id"],
                task_id=args["task_id"],
                progress_pct=args.get("progress_pct"),
                agent_notes=args.get("agent_notes"),
                comment=args.get("comment"),
            )
        else:
            result = f"Unknown tool: {name}"
    except Exception as exc:
        result = f"Tool error: {exc}"

    return [types.TextContent(type="text", text=result)]


# ── MCP Resources ────────────────────────────────────────────────


@server.list_resources()
async def list_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri="todo://summary",
            name="Platform Summary",
            description="Comprehensive summary of all projects, tasks, and recent activity",
            mimeType="application/json",
        ),
        types.Resource(
            uri="todo://activity",
            name="Recent Activity",
            description="Recent activity log showing what changed and by whom",
            mimeType="application/json",
        ),
        types.Resource(
            uri="todo://notifications",
            name="Unread Notifications",
            description="Unread in-app notifications",
            mimeType="application/json",
        ),
        types.Resource(
            uri="todo://agent-context",
            name="Agent Context",
            description="Platform capabilities, conventions, and agent instructions",
            mimeType="application/json",
        ),
    ]


@server.list_resource_templates()
async def list_resource_templates() -> list[types.ResourceTemplate]:
    return [
        types.ResourceTemplate(
            uriTemplate="todo://projects/{project_id}",
            name="Project Detail",
            description="Full project detail including all tasks",
            mimeType="application/json",
        ),
    ]


@server.read_resource()
async def read_resource(uri) -> list[types.TextResourceContents]:
    uri_str = str(uri)

    if uri_str == "todo://summary":
        data = await _get("/summary")
    elif uri_str == "todo://activity":
        data = await _get("/activity", params={"limit": 50})
    elif uri_str == "todo://notifications":
        data = await _get("/notifications", params={"unread_only": "true", "limit": 50})
    elif uri_str == "todo://agent-context":
        data = await _get("/agent-context")
    elif uri_str.startswith("todo://projects/"):
        project_id = uri_str.split("todo://projects/")[1]
        data = await _get(f"/projects/{project_id}")
    else:
        data = {"error": f"Unknown resource: {uri_str}"}

    text = json.dumps(data, indent=2) if not isinstance(data, str) else data
    return [types.TextResourceContents(uri=uri, text=text, mimeType="application/json")]


# ── MCP Prompts ──────────────────────────────────────────────────


@server.list_prompts()
async def list_prompts() -> list[types.Prompt]:
    return [
        types.Prompt(
            name="plan-my-day",
            description="Review overdue and in-progress tasks, then suggest a prioritized plan for today",
        ),
        types.Prompt(
            name="project-review",
            description="Summarize a project's current state, identify blockers, and suggest next actions",
            arguments=[
                types.PromptArgument(
                    name="project_name",
                    description="Name or ID of the project to review",
                    required=True,
                ),
            ],
        ),
        types.Prompt(
            name="triage-inbox",
            description="Review all todo tasks and help prioritize them by urgency and importance",
        ),
        types.Prompt(
            name="weekly-summary",
            description="Generate a summary of accomplishments and progress from the past week",
        ),
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: dict | None = None) -> types.GetPromptResult:
    if name == "plan-my-day":
        return types.GetPromptResult(
            description="Plan your day based on current tasks",
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=(
                            "Please review my current tasks using the get_summary tool, "
                            "then help me plan my day. Focus on:\n"
                            "1. Overdue tasks that need immediate attention\n"
                            "2. In-progress tasks I should continue\n"
                            "3. High-priority todo tasks to start today\n"
                            "4. Suggest a realistic schedule considering task dependencies\n\n"
                            "Be specific about which tasks to tackle and in what order."
                        ),
                    ),
                ),
            ],
        )

    if name == "project-review":
        project_name = (arguments or {}).get("project_name", "")
        return types.GetPromptResult(
            description=f"Review project: {project_name}",
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=(
                            f"Please review the project '{project_name}'. Use the search tool to find it, "
                            "then list its tasks. Provide:\n"
                            "1. Overall progress and health assessment\n"
                            "2. Blocked or stalled tasks\n"
                            "3. Overdue items\n"
                            "4. Suggested next actions to move the project forward\n"
                            "5. Any risks or concerns"
                        ),
                    ),
                ),
            ],
        )

    if name == "triage-inbox":
        return types.GetPromptResult(
            description="Triage and prioritize todo tasks",
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=(
                            "Please review all tasks with 'todo' status across all projects. "
                            "Help me triage them by:\n"
                            "1. Identifying tasks that should be high priority\n"
                            "2. Grouping related tasks that could be batched\n"
                            "3. Flagging tasks that are unclear and need more detail\n"
                            "4. Suggesting which tasks to start next\n"
                            "5. Identifying any tasks that might be obsolete"
                        ),
                    ),
                ),
            ],
        )

    if name == "weekly-summary":
        return types.GetPromptResult(
            description="Weekly progress summary",
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=(
                            "Please generate a weekly summary of my work. Use the get_activity tool "
                            "with a limit of 200 to get recent activity, then:\n"
                            "1. List tasks completed this week\n"
                            "2. List tasks started or progressed\n"
                            "3. Highlight any blockers encountered\n"
                            "4. Calculate overall velocity (tasks done per day)\n"
                            "5. Suggest focus areas for next week"
                        ),
                    ),
                ),
            ],
        )

    return types.GetPromptResult(
        description="Unknown prompt",
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=f"Unknown prompt: {name}"),
            ),
        ],
    )


async def main_stdio():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


def create_http_app():
    """Create a Starlette ASGI app for Streamable HTTP transport."""
    from contextlib import asynccontextmanager

    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response
    from starlette.routing import Mount, Route

    http_token = os.environ.get("MCP_HTTP_TOKEN", "")

    session_manager = StreamableHTTPSessionManager(
        app=server,
        json_response=False,
        stateless=True,
    )

    async def auth_check(request: Request):
        if http_token:
            auth = request.headers.get("authorization", "")
            token = auth.removeprefix("Bearer ").strip()
            if token != http_token:
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return None

    async def handle_mcp(request: Request):
        err = await auth_check(request)
        if err:
            return err
        await session_manager.handle_request(
            request.scope, request.receive, request._send
        )
        return Response()

    @asynccontextmanager
    async def lifespan(app):
        async with session_manager.run():
            yield

    app = Starlette(
        lifespan=lifespan,
        routes=[
            Route("/mcp", endpoint=handle_mcp, methods=["GET", "POST", "DELETE"]),
        ],
        middleware=[
            Middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_methods=["*"],
                allow_headers=["*"],
            ),
        ],
    )
    return app


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "http":
        import uvicorn

        app = create_http_app()
        port = int(os.environ.get("MCP_HTTP_PORT", "8001"))
        uvicorn.run(app, host="0.0.0.0", port=port)
    else:
        asyncio.run(main_stdio())
