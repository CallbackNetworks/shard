"""
External API v1 — Tools schema endpoint for AI agent discovery.

Returns tool definitions in OpenAI function-calling format so HTTP-based
agents (Hermes, etc.) can auto-discover available operations.
"""

from fastapi import APIRouter, Depends

from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope

sub_router = APIRouter()

TOOLS_SCHEMA = [
    {
        "name": "get_summary",
        "description": "Get a comprehensive summary of the platform: project stats, active/overdue tasks, and recent activity. Best starting point for understanding current state.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_agent_context",
        "description": "Get platform onboarding context: capabilities, conventions, per-project agent instructions, and a quick-start guide.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "list_projects",
        "description": "List all projects, optionally filtered by status.",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "archived"],
                    "description": "Filter by project status",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_project_detail",
        "description": "Get a single project with all its tasks, labels, and stats in one call.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "create_project",
        "description": "Create a new project.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Project name"},
                "description": {"type": "string", "description": "Project description"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "list_tasks",
        "description": "List tasks for a project, optionally filtered by status and/or priority.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "status": {
                    "type": "string",
                    "enum": ["todo", "in_progress", "done", "failed"],
                    "description": "Filter by status",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Filter by priority",
                },
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "create_task",
        "description": "Create a new task in a project.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "title": {"type": "string", "description": "Task title (1-500 chars, imperative form)"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Default: medium"},
                "description": {"type": "string", "description": "Task description (markdown)"},
                "assignee": {"type": "string", "description": "Assignee identifier (e.g. agent:claude-code)"},
                "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format"},
            },
            "required": ["project_id", "title"],
        },
    },
    {
        "name": "update_task",
        "description": "Update one or more fields on a task. Status changes trigger notifications.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
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
    },
    {
        "name": "delete_task",
        "description": "Permanently delete a task.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
            },
            "required": ["project_id", "task_id"],
        },
    },
    {
        "name": "create_subtask",
        "description": "Create a subtask under an existing task.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "parent_task_id": {"type": "string", "description": "Parent task ID"},
                "title": {"type": "string", "description": "Subtask title"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": ["project_id", "parent_task_id", "title"],
        },
    },
    {
        "name": "bulk_update_tasks",
        "description": "Batch update multiple tasks in one request. Each item needs an 'id' and fields to change.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string", "description": "Task ID"},
                            "status": {"type": "string", "enum": ["todo", "in_progress", "done", "failed"]},
                            "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                            "title": {"type": "string"},
                            "assignee": {"type": "string"},
                        },
                        "required": ["id"],
                    },
                    "description": "Array of task updates",
                },
            },
            "required": ["project_id", "updates"],
        },
    },
    {
        "name": "report_progress",
        "description": "Report intermediate progress on a task. Updates percentage, agent notes, and optionally adds a comment.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "progress_pct": {"type": "integer", "description": "Progress percentage 0-100"},
                "agent_notes": {"type": "string", "description": "Agent status notes (markdown)"},
                "comment": {"type": "string", "description": "Optional comment visible to humans"},
            },
            "required": ["project_id", "task_id"],
        },
    },
    {
        "name": "search",
        "description": "Full-text search across tasks and projects by keyword.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords"},
                "limit": {"type": "integer", "description": "Max results (default 20)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "add_comment",
        "description": "Add a comment to a task. Useful for leaving notes, progress updates, or context.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "body": {"type": "string", "description": "Comment text (markdown supported)"},
                "author": {"type": "string", "description": "Author name (optional)"},
            },
            "required": ["project_id", "task_id", "body"],
        },
    },
    {
        "name": "list_comments",
        "description": "List all comments on a task in chronological order.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
            },
            "required": ["project_id", "task_id"],
        },
    },
    {
        "name": "manage_labels",
        "description": "List project labels, or add/remove a label from a task.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "project_id": {"type": "string", "description": "Project ID (required for all)"},
                "task_id": {"type": "string", "description": "Task ID (required for add/remove)"},
                "label_id": {"type": "string", "description": "Label ID (required for add/remove)"},
            },
            "required": ["action", "project_id"],
        },
    },
    {
        "name": "manage_dependencies",
        "description": "View, add, or remove task dependencies (blocker relationships).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "depends_on_id": {"type": "string", "description": "ID of the blocking task (for add/remove)"},
            },
            "required": ["action", "project_id", "task_id"],
        },
    },
    {
        "name": "get_activity",
        "description": "Get recent activity log entries showing what changed and who did it.",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of entries (default 20, max 200)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_notifications",
        "description": "Get in-app notifications for recent events.",
        "parameters": {
            "type": "object",
            "properties": {
                "unread_only": {"type": "boolean", "description": "Only unread (default true)"},
                "limit": {"type": "integer", "description": "Max notifications (default 20)"},
            },
            "required": [],
        },
    },
    {
        "name": "analyze_workload",
        "description": "Analyze workload: tasks by status, priority, overdue count. Per-project or platform-wide.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Optional; platform overview if omitted"},
            },
            "required": [],
        },
    },
]


@sub_router.get(
    "/tools-schema",
    summary="AI agent tool definitions",
    description=(
        "Returns available tool definitions in OpenAI function-calling format. "
        "HTTP-based AI agents can fetch this to auto-discover operations without "
        "manual schema configuration. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_tools_schema(
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return TOOLS_SCHEMA
