"""
Tool definitions and implementations for the LLM Assistant.
Each tool is a JSON schema (for the LLM) + a Python function (for execution).

ADR-0102 added the task/project-domain subset of what MCP already offered (comments,
dependencies, notifications, project reads/writes, decisions/cycles/analytics/recurrence/
templates/attachments, import/transfer, graph orientation) — everything here calls the
same service/graph functions MCP's `/api/v1` doors call, but directly with the in-process
`db`, skipping the HTTP hop scope-checking machinery (`_require_scope`/`_check_project_access`
in `routers/external_api/auth.py`) has no equivalent here: this assistant already runs with
full access, same trust level as the rest of the internal `/api`, not an external API key's
restricted scope. Deliberately excluded (ADR-0102): anything touching instance
configuration, credentials, or an external side effect a human should see fire —
settings, backups, webhook/share secrets, integrations, CI triggers, the node/edge type
registry, workflow rules, sending email, publishing an external issue.
"""

import json
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models import ActivityLog, Comment, Edge, Node, Notification, TaskTemplate, WorkflowRule
from app.schemas import RecurrenceRuleCreate, RecurrenceRuleOut, RecurrenceRuleUpdate, TaskImportItem
from app.services import (
    analytics_admin,
    ancestry,
    attachment_admin,
    cycle_admin,
    decision_admin,
    graph,
    recurrence_admin,
    task_filing,
    task_import,
    task_transfer,
)
from app.services.activity import log_activity
from app.services.enrichment import enrich_container_subtree
from app.services.errors import ServiceError
from app.services.graph_dispatch import (
    dispatch_edge_added,
    dispatch_edge_removed,
    dispatch_node_created,
    dispatch_node_deleted,
)
from app.services.notifier import fire_notifications
from app.services.task_import import GitHubImport, LinearImport, TrelloImport
from app.services.task_mutations import apply_task_update, finalize_task_create

TOOLS = [
    {
        "name": "get_summary",
        "description": "Get a high-level summary of all projects and tasks. Good starting point.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "list_tasks",
        "description": "List tasks for a project, optionally filtered by status.",
        "input_schema": {
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
    },
    {
        "name": "create_task",
        "description": "Create a new task in a project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "title": {"type": "string", "description": "Task title"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Priority"},
                "description": {"type": "string", "description": "Optional description"},
                "assignee": {"type": "string", "description": "Assignee name"},
                "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format"},
            },
            "required": ["project_id", "title"],
        },
    },
    {
        "name": "update_task",
        "description": "Update task fields: status, priority, due_date, assignee, title, description, time_estimate, time_spent.",
        "input_schema": {
            "type": "object",
            "properties": {
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
            "required": ["task_id"],
        },
    },
    {
        "name": "create_subtask",
        "description": "Create a subtask under an existing task.",
        "input_schema": {
            "type": "object",
            "properties": {
                "parent_task_id": {"type": "string", "description": "Parent task ID"},
                "title": {"type": "string", "description": "Subtask title"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": ["parent_task_id", "title"],
        },
    },
    {
        "name": "manage_labels",
        "description": "Add or remove a label from a task, or list labels for a project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"], "description": "Action to perform"},
                "project_id": {"type": "string", "description": "Project ID (required for list)"},
                "task_id": {"type": "string", "description": "Task ID (required for add/remove)"},
                "label_id": {"type": "string", "description": "Label ID (required for add/remove)"},
            },
            "required": ["action"],
        },
    },
    {
        "name": "analyze_workload",
        "description": "Analyze workload distribution: tasks by status, priority, overdue count, and per-assignee breakdown.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID (optional, all projects if omitted)"},
            },
            "required": [],
        },
    },
    {
        "name": "search",
        "description": "Search for tasks or projects by keyword.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_activity",
        "description": "Get recent activity log.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of entries (default 20)"},
            },
            "required": [],
        },
    },
    {
        "name": "analyze_decisions",
        "description": "Gather comprehensive project context (tasks, activity, comments, workflow rules, existing decisions) for decision analysis. Call this first, then reason about implied decisions from the data.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID to analyze"},
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "create_decision",
        "description": "Create a decision record (as a decision-type label) for a project. Status is set to 'proposed' for user review.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "name": {"type": "string", "description": "Decision title (short, clear)"},
                "description": {
                    "type": "string",
                    "description": "Decision content in markdown with ## Context, ## Decision, ## Consequences sections",
                },
            },
            "required": ["project_id", "name", "description"],
        },
    },
    {
        "name": "tag_task_with_decision",
        "description": "Tag a task with a decision label and add a comment explaining the relevance.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID to tag"},
                "decision_label_id": {"type": "string", "description": "Decision label ID to attach"},
                "reason": {
                    "type": "string",
                    "description": "Explanation of why this task relates to or conflicts with the decision",
                },
            },
            "required": ["task_id", "decision_label_id", "reason"],
        },
    },
    {
        "name": "batch_create_tasks",
        "description": (
            "Create multiple tasks at once from a parsed list. Use this when the user provides "
            "a block of text (meeting notes, a plan, a todo list) and you need to create "
            "several tasks from it. Parse the text into structured tasks first, then call this tool."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID to create tasks in"},
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Task title (imperative form)"},
                            "priority": {
                                "type": "string",
                                "enum": ["low", "medium", "high"],
                                "description": "Default: medium",
                            },
                            "description": {"type": "string", "description": "Optional description"},
                            "due_date": {"type": "string", "description": "Optional due date (YYYY-MM-DD)"},
                            "subtasks": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "title": {"type": "string"},
                                        "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                                    },
                                    "required": ["title"],
                                },
                                "description": "Optional subtasks",
                            },
                        },
                        "required": ["title"],
                    },
                    "description": "Array of tasks to create",
                },
            },
            "required": ["project_id", "tasks"],
        },
    },
    {
        "name": "add_comment",
        "description": "Add a comment to a task. Supports markdown.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID"},
                "body": {"type": "string", "description": "Comment body, supports markdown"},
            },
            "required": ["task_id", "body"],
        },
    },
    {
        "name": "list_comments",
        "description": "List all comments on a task in chronological order.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string", "description": "Task ID"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "manage_dependencies",
        "description": "View, add, or remove task dependencies (blocker relationships).",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "task_id": {"type": "string", "description": "Task ID"},
                "depends_on_id": {"type": "string", "description": "Required for add/remove — the blocking task"},
            },
            "required": ["action", "task_id"],
        },
    },
    {
        "name": "get_notifications",
        "description": "Get in-app notifications. Useful for checking what events occurred recently.",
        "input_schema": {
            "type": "object",
            "properties": {
                "unread_only": {"type": "boolean", "description": "Default true"},
                "limit": {"type": "integer", "description": "Default 20"},
            },
            "required": [],
        },
    },
    {
        "name": "manage_notifications",
        "description": (
            "Act on notifications: 'unread_count', 'read' one, 'read_all', or 'delete' one. "
            "Reading the list itself is get_notifications — this is the half that clears them."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["unread_count", "read", "read_all", "delete"]},
                "notification_id": {"type": "string", "description": "Required for 'read' and 'delete'"},
            },
            "required": ["action"],
        },
    },
    {
        "name": "report_progress",
        "description": "Report intermediate progress on a task: progress percentage, agent notes, optionally a comment.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID"},
                "progress_pct": {"type": "integer", "description": "0-100"},
                "agent_notes": {"type": "string", "description": "Markdown scratchpad"},
                "comment": {"type": "string", "description": "If provided, adds a comment to the task"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "list_projects",
        "description": "List all projects, optionally filtered by status.",
        "input_schema": {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["active", "archived"]}},
            "required": [],
        },
    },
    {
        "name": "create_project",
        "description": "Create a new project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Project name"},
                "description": {"type": "string", "description": "Optional description"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "get_project_detail",
        "description": (
            "Get a single project with its own tasks, progress and labels in one call. "
            "Shows only the project's own tasks, not nested containers — for that, use "
            "get_container_subtree."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"project_id": {"type": "string", "description": "Project ID"}},
            "required": ["project_id"],
        },
    },
    {
        "name": "delete_task",
        "description": "Permanently delete a task. Irreversible.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string", "description": "Task ID"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "get_container_subtree",
        "description": (
            "A container's task rollup over everything it contains, plus the containers "
            "directly inside it (each with its own rollup). Use this to find work that "
            "lives one or more levels below a project: list_tasks and get_project_detail "
            "only show a container's own tasks, not nested containers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string", "description": "A project or any custom container"}},
            "required": ["node_id"],
        },
    },
    {
        "name": "bulk_update_tasks",
        "description": "Batch-update multiple existing tasks in one call. Each item needs an 'id' plus the fields to change.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "updates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "description": (
                            "Needs 'id' plus fields to change: status, priority, title, "
                            "description, assignee, due_date, time_estimate, time_spent, "
                            "parent_id"
                        ),
                    },
                    "description": "Array of {id, ...fields to change}",
                },
            },
            "required": ["project_id", "updates"],
        },
    },
    {
        "name": "manage_unfiled",
        "description": (
            "List or file the unfiled bucket: tasks that belong to no project at all. "
            "'file' gives a task its first project — idempotent."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "file"]},
                "task_id": {"type": "string", "description": "Required for 'file'"},
                "project_id": {"type": "string", "description": "Required for 'file'"},
            },
            "required": ["action"],
        },
    },
    {
        "name": "get_graph_map",
        "description": (
            "The whole graph in one call — nodes and the edges between them. Narrow with "
            "types (comma-separated node type keys). This is the orientation call: it "
            "shows which containers exist and how they nest, which listing projects "
            "cannot. Never includes a node's raw data payload (credentials may live there)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "types": {"type": "string", "description": "Comma-separated node type keys to include"},
                "limit": {"type": "integer", "description": "Default 500, capped at 2000"},
            },
            "required": [],
        },
    },
    {
        "name": "get_ancestry",
        "description": (
            "Where these nodes live and whose they are. For each id: 'trails' are the "
            "containment paths above it, root-first — several when a node has several "
            "parents — and 'owners' are the identities that own it. Ask this before "
            "reporting on a project: the project list says nothing about the identity or "
            "organization it sits under."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "node_ids": {"type": "array", "items": {"type": "string"}, "description": "Up to 200 node IDs"},
            },
            "required": ["node_ids"],
        },
    },
    {
        "name": "list_decisions",
        "description": "List decision records and their status (proposed/accepted/superseded/deprecated).",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Optional, all projects if omitted"},
                "status": {"type": "string", "enum": ["proposed", "accepted", "superseded", "deprecated"]},
            },
            "required": [],
        },
    },
    {
        "name": "export_decision",
        "description": "Export one decision record as a Markdown document ready to save as an ADR.",
        "input_schema": {
            "type": "object",
            "properties": {"decision_id": {"type": "string", "description": "Decision ID"}},
            "required": ["decision_id"],
        },
    },
    {
        "name": "manage_cycles",
        "description": (
            "Read and roll over cycles (sprints). 'list'/'get' return a cycle with its "
            "tasks; 'compare' puts two cycles side by side; 'duplicate' rolls a cycle over "
            "into a fresh draft cycle carrying its tasks (as new todos, not the old ones' "
            "status/time-spent)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "get", "compare", "duplicate"]},
                "project_id": {"type": "string", "description": "Project ID"},
                "cycle_id": {"type": "string", "description": "Required for get/compare/duplicate"},
                "compare_with": {"type": "string", "description": "Required for compare — the other cycle ID"},
            },
            "required": ["action", "project_id"],
        },
    },
    {
        "name": "get_analytics",
        "description": (
            "One planning report at a time. 'burndown'/'cycle_burndown' need cycle_id; "
            "'critical_path' needs project_id and returns the longest dependency chain; "
            "'estimation_calibration' compares past estimates against actuals for a "
            "project (or globally if omitted); 'estimate_suggestion' takes raw_estimate "
            "and corrects it by that history."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "report": {
                    "type": "string",
                    "enum": [
                        "burndown",
                        "cycle_burndown",
                        "critical_path",
                        "estimation_calibration",
                        "estimate_suggestion",
                    ],
                },
                "project_id": {"type": "string"},
                "cycle_id": {"type": "string"},
                "raw_estimate": {"type": "integer", "description": "Required for estimate_suggestion, in minutes"},
            },
            "required": ["report"],
        },
    },
    {
        "name": "manage_recurrence",
        "description": (
            "Read or set a task's recurrence. config for create/update: {frequency: "
            "daily|weekly|monthly|interval, next_run_at: ISO timestamp, interval_value?: "
            "int, day_of_week?: 0-6, day_of_month?: 1-31, end_date?: ISO, active?: bool}. "
            "A task has at most one rule; 'create' on a task that already has one fails — "
            "use 'update' instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["get", "create", "update", "delete"]},
                "project_id": {"type": "string", "description": "Project ID"},
                "task_id": {"type": "string", "description": "Task ID"},
                "config": {"type": "object", "description": "Required for create/update"},
            },
            "required": ["action", "project_id", "task_id"],
        },
    },
    {
        "name": "manage_templates",
        "description": (
            "List, create, update or delete task templates. config for create: {name, "
            "description?, priority?: low|medium|high, subtasks?: [{title, priority?}], "
            "label_names?: [str], project_id?}. A template with no project_id is global."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "create", "update", "delete"]},
                "template_id": {"type": "string", "description": "Required for update/delete"},
                "project_id": {"type": "string", "description": "Filter for list; scope for create"},
                "config": {"type": "object", "description": "Required for create/update"},
            },
            "required": ["action"],
        },
    },
    {
        "name": "manage_attachments",
        "description": (
            "List or delete a task's file attachments. Uploading is not available from "
            "the assistant — use the app to attach a file."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "delete"]},
                "task_id": {"type": "string", "description": "Task ID"},
                "attachment_id": {"type": "string", "description": "Required for delete"},
            },
            "required": ["action", "task_id"],
        },
    },
    {
        "name": "import_tasks",
        "description": (
            "Import a batch of issues or cards as tasks. Labels are matched by name in "
            "the project and created if missing; a closed issue or card becomes a done "
            "task. Partial success: the result is {imported, skipped, errors}."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project ID"},
                "source": {"type": "string", "enum": ["github", "linear", "trello"]},
                "payload": {
                    "type": "object",
                    "description": (
                        "github: {issues:[{number,title,body,state,html_url,labels:[{name}],"
                        "assignee:{login}}]}; linear: {issues:[{title,description,state,"
                        "priority,assignee,labels:[]}]}; trello: {cards:[{name,desc,closed,"
                        "due,labels:[{name}]}]}"
                    ),
                },
            },
            "required": ["project_id", "source", "payload"],
        },
    },
    {
        "name": "transfer_tasks",
        "description": (
            "Export a project's tasks as JSON, or import a batch back. Unlike "
            "import_tasks (which speaks Trello/Linear/GitHub), this is the platform's own "
            "shape and round-trips: what export gives you is what import takes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["export", "import"]},
                "project_id": {"type": "string", "description": "Project ID"},
                "tasks": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": (
                        "Required for 'import': [{title, description?, status?, priority?, "
                        "assignee?, due_date?, subtasks?: [same shape]}]"
                    ),
                },
            },
            "required": ["action", "project_id"],
        },
    },
]


async def dispatch_tool(tool_name: str, tool_input: dict, db: Session) -> str:
    """Execute a tool call and return the result as a string."""
    try:
        if tool_name == "get_summary":
            return await _tool_get_summary(db)
        elif tool_name == "list_tasks":
            return _tool_list_tasks(db, **tool_input)
        elif tool_name == "create_task":
            return await _tool_create_task(db, **tool_input)
        elif tool_name == "update_task":
            return await _tool_update_task(db, **tool_input)
        elif tool_name == "update_task_status":
            # Backward compat alias
            return await _tool_update_task(db, task_id=tool_input["task_id"], status=tool_input["status"])
        elif tool_name == "create_subtask":
            return await _tool_create_subtask(db, **tool_input)
        elif tool_name == "manage_labels":
            return await _tool_manage_labels(db, **tool_input)
        elif tool_name == "analyze_workload":
            return _tool_analyze_workload(db, tool_input.get("project_id"))
        elif tool_name == "search":
            return _tool_search(db, tool_input.get("query", ""))
        elif tool_name == "get_activity":
            return _tool_get_activity(db, tool_input.get("limit", 20))
        elif tool_name == "analyze_decisions":
            return _tool_analyze_decisions(db, tool_input["project_id"])
        elif tool_name == "create_decision":
            return _tool_create_decision(db, **tool_input)
        elif tool_name == "tag_task_with_decision":
            return await _tool_tag_task_with_decision(db, **tool_input)
        elif tool_name == "batch_create_tasks":
            return await _tool_batch_create_tasks(db, **tool_input)
        elif tool_name == "add_comment":
            return await _tool_add_comment(db, **tool_input)
        elif tool_name == "list_comments":
            return _tool_list_comments(db, **tool_input)
        elif tool_name == "manage_dependencies":
            return await _tool_manage_dependencies(db, **tool_input)
        elif tool_name == "get_notifications":
            return _tool_get_notifications(db, **tool_input)
        elif tool_name == "manage_notifications":
            return _tool_manage_notifications(db, **tool_input)
        elif tool_name == "report_progress":
            return _tool_report_progress(db, **tool_input)
        elif tool_name == "list_projects":
            return _tool_list_projects(db, tool_input.get("status"))
        elif tool_name == "create_project":
            return await _tool_create_project(db, **tool_input)
        elif tool_name == "get_project_detail":
            return _tool_get_project_detail(db, tool_input["project_id"])
        elif tool_name == "delete_task":
            return await _tool_delete_task(db, tool_input["task_id"])
        elif tool_name == "get_container_subtree":
            return _tool_get_container_subtree(db, tool_input["node_id"])
        elif tool_name == "bulk_update_tasks":
            return await _tool_bulk_update_tasks(db, **tool_input)
        elif tool_name == "manage_unfiled":
            return await _tool_manage_unfiled(db, **tool_input)
        elif tool_name == "get_graph_map":
            return _tool_get_graph_map(db, tool_input.get("types"), tool_input.get("limit", 500))
        elif tool_name == "get_ancestry":
            return _tool_get_ancestry(db, tool_input["node_ids"])
        elif tool_name == "list_decisions":
            return _tool_list_decisions(db, tool_input.get("project_id"), tool_input.get("status"))
        elif tool_name == "export_decision":
            return _tool_export_decision(db, tool_input["decision_id"])
        elif tool_name == "manage_cycles":
            return await _tool_manage_cycles(db, **tool_input)
        elif tool_name == "get_analytics":
            return _tool_get_analytics(db, **tool_input)
        elif tool_name == "manage_recurrence":
            return _tool_manage_recurrence(db, **tool_input)
        elif tool_name == "manage_templates":
            return _tool_manage_templates(db, **tool_input)
        elif tool_name == "manage_attachments":
            return _tool_manage_attachments(db, **tool_input)
        elif tool_name == "import_tasks":
            return await _tool_import_tasks(db, **tool_input)
        elif tool_name == "transfer_tasks":
            return await _tool_transfer_tasks(db, **tool_input)
        else:
            return f"Unknown tool: {tool_name}"
    except Exception as exc:
        return f"Tool error: {exc}"


async def _tool_get_summary(db: Session) -> str:
    projects = graph.all_projects(db, status="active")
    result = []
    for p in projects:
        p_tasks = graph.subtree_task_views(db, p.id)
        sub = graph.subtask_ids_among(db, [t.id for t in p_tasks])
        total = len([t for t in p_tasks if t.id not in sub])
        done = sum(1 for t in p_tasks if t.status == "done" and t.id not in sub)
        in_prog = sum(1 for t in p_tasks if t.status == "in_progress" and t.id not in sub)
        overdue = sum(1 for t in p_tasks if graph.is_overdue(t, datetime.now(UTC)))
        result.append(
            {
                "id": p.id,
                "name": p.name,
                "total": total,
                "done": done,
                "in_progress": in_prog,
                "overdue": overdue,
                "progress": f"{round(done / total * 100, 1) if total else 0}%",
            }
        )
    return json.dumps(result, default=str)


def _tool_list_tasks(db: Session, project_id: str, status: str | None = None) -> str:
    q = db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(graph.contained_task_ids(db, project_id)))
    if status:
        q = q.filter(Node.status == status)
    tasks = [graph.task_view(n, db) for n in q.order_by(Node.created_at.desc()).limit(50).all()]
    return json.dumps(
        [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "assignee": t.assignee,
                "due_date": t.due_date.isoformat() if t.due_date else None,
            }
            for t in tasks
        ],
        default=str,
    )


async def _tool_create_task(
    db: Session,
    project_id: str,
    title: str,
    priority: str = "medium",
    description: str | None = None,
    assignee: str | None = None,
    due_date: str | None = None,
) -> str:
    import uuid

    title = title.strip()
    if not title:
        return "Title must not be blank"
    if len(title) > 500:
        return "Title must be 500 characters or fewer"
    project = graph.get_project(db, project_id)
    if not project:
        return f"Project {project_id} not found"
    due = datetime.strptime(due_date, "%Y-%m-%d").replace(tzinfo=UTC) if due_date else None
    task = graph.create_task(
        db,
        id=str(uuid.uuid4()),
        project_id=project_id,
        title=title,
        priority=priority,
        description=description,
        assignee=assignee,
        due_date=due,
        callback_token=str(uuid.uuid4()),
    )
    task = await finalize_task_create(db, task.id, actor="assistant", source="assistant", project_id=project_id)
    return json.dumps({"id": task.id, "title": task.title, "status": task.status})


async def _tool_update_task(db: Session, task_id: str, **kwargs) -> str:
    if graph.get_task(db, task_id) is None:
        return f"Task {task_id} not found"
    updatable = ("status", "priority", "title", "description", "assignee", "time_estimate", "time_spent")
    changes = {field: kwargs[field] for field in updatable if field in kwargs and kwargs[field] is not None}
    if "due_date" in kwargs:
        val = kwargs["due_date"]
        if val and val != "null":
            changes["due_date"] = (
                datetime.fromisoformat(val).replace(tzinfo=UTC)
                if "T" in val
                else datetime.strptime(val, "%Y-%m-%d").replace(tzinfo=UTC)
            )
        else:
            changes["due_date"] = None
    task = await apply_task_update(db, task_id, changes, actor="assistant", source="assistant")
    return json.dumps(
        {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "due_date": task.due_date.isoformat() if task.due_date else None,
        }
    )


async def _tool_create_subtask(db: Session, parent_task_id: str, title: str, priority: str = "medium") -> str:
    import uuid

    title = title.strip()
    if not title:
        return "Title must not be blank"
    if len(title) > 500:
        return "Title must be 500 characters or fewer"
    parent = graph.get_task(db, parent_task_id)
    if not parent:
        return f"Parent task {parent_task_id} not found"
    parent_project_id = graph.project_id_of_task(db, parent.id)
    task = graph.create_task(
        db,
        id=str(uuid.uuid4()),
        project_id=parent_project_id,
        title=title,
        priority=priority,
        parent_id=parent_task_id,
        callback_token=str(uuid.uuid4()),
    )
    task = await finalize_task_create(db, task.id, actor="assistant", source="assistant", project_id=parent_project_id)
    return json.dumps({"id": task.id, "title": task.title, "parent_id": parent_task_id})


async def _tool_manage_labels(
    db: Session, action: str, project_id: str | None = None, task_id: str | None = None, label_id: str | None = None
) -> str:
    if action == "list":
        if not project_id:
            return "project_id required for list action"
        labels = graph.labels_in_project(db, project_id)
        return json.dumps([{"id": lb.id, "name": lb.name, "color": lb.color} for lb in labels])
    elif action == "add":
        if not task_id or not label_id:
            return "task_id and label_id required for add action"
        if label_id in graph.label_ids_for_task(db, task_id):
            return "Label already assigned"
        graph.set_label(db, task_id, label_id)
        await dispatch_edge_added(db, task_id, label_id, graph.REL_LABELED, actor="assistant")
        return json.dumps({"status": "added", "task_id": task_id, "label_id": label_id})
    elif action == "remove":
        if not task_id or not label_id:
            return "task_id and label_id required for remove action"
        if graph.unset_label(db, task_id, label_id):
            await dispatch_edge_removed(db, task_id, label_id, graph.REL_LABELED, actor="assistant")
        return json.dumps({"status": "removed", "task_id": task_id, "label_id": label_id})
    return f"Unknown label action: {action}"


def _tool_analyze_workload(db: Session, project_id: str | None = None) -> str:
    q = db.query(Node).filter(graph.task_type_filter(db), graph.top_level_task_filter(db))
    if project_id:
        q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
    tasks = [graph.task_view(n, db) for n in q.all()]

    now = datetime.now(UTC)
    by_status = {}
    by_priority = {}
    by_assignee = {}
    overdue = 0
    total_estimate = 0
    total_spent = 0

    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
        assignee = t.assignee or "(unassigned)"
        if assignee not in by_assignee:
            by_assignee[assignee] = {"total": 0, "done": 0, "in_progress": 0}
        by_assignee[assignee]["total"] += 1
        if t.status == "done":
            by_assignee[assignee]["done"] += 1
        elif t.status == "in_progress":
            by_assignee[assignee]["in_progress"] += 1
        if graph.is_overdue(t, now):
            overdue += 1
        if t.time_estimate:
            total_estimate += t.time_estimate
        if t.time_spent:
            total_spent += t.time_spent

    return json.dumps(
        {
            "total_tasks": len(tasks),
            "by_status": by_status,
            "by_priority": by_priority,
            "by_assignee": by_assignee,
            "overdue": overdue,
            "total_estimate_hours": round(total_estimate / 60, 1),
            "total_spent_hours": round(total_spent / 60, 1),
        }
    )


def _tool_search(db: Session, query: str) -> str:
    q = query.lower()
    # title/description live on the task node (description in JSON data); scan in
    # Python for dialect-safe substring matching (ADR-0033, node-only tasks).
    tasks = [
        graph.task_view(n, db)
        for n in db.query(Node).filter(graph.task_type_filter(db)).all()
        if q in (n.title or "").lower() or q in ((n.data or {}).get("description") or "").lower()
    ][:20]
    projects = graph.search_projects(db, q, limit=10)
    task_projects = graph.project_ids_map(db, [t.id for t in tasks])
    return json.dumps(
        {
            "tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "project_id": next(iter(task_projects.get(t.id, [])), None),
                }
                for t in tasks
            ],
            "projects": [{"id": p.id, "name": p.name} for p in projects],
        }
    )


def _tool_get_activity(db: Session, limit: int = 20) -> str:
    logs = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return json.dumps(
        [
            {
                "action": entry.action,
                "detail": entry.detail,
                "actor": entry.actor,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry in logs
        ],
        default=str,
    )


def _tool_analyze_decisions(db: Session, project_id: str) -> str:
    project = graph.get_project(db, project_id)
    if not project:
        return f"Project {project_id} not found"

    # Tasks with details
    task_nodes = (
        db.query(Node)
        .filter(graph.task_type_filter(db), Node.id.in_(graph.contained_task_ids(db, project_id)))
        .order_by(Node.created_at.desc())
        .limit(100)
        .all()
    )
    tasks = [graph.task_view(n, db) for n in task_nodes]
    tasks_data = [
        {
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "priority": t.priority,
            "assignee": t.assignee,
            "description": (t.description or "")[:200],
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tasks
    ]

    # Activity logs for this project
    activities = (
        db.query(ActivityLog)
        .filter(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(100)
        .all()
    )
    activity_data = [
        {
            "action": a.action,
            "detail": a.detail,
            "actor": a.actor,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in activities
    ]

    # Comments on tasks in this project
    task_ids = [t.id for t in tasks]
    comments = (
        db.query(Comment).filter(Comment.task_id.in_(task_ids)).order_by(Comment.created_at.desc()).limit(50).all()
        if task_ids
        else []
    )
    comments_data = [
        {
            "task_id": c.task_id,
            "body": (c.body or "")[:300],
            "author": c.author,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in comments
    ]

    # Workflow rules
    rules = db.query(WorkflowRule).filter(WorkflowRule.project_id == project_id).all()
    rules_data = [
        {"name": r.name, "trigger": r.trigger, "conditions": r.conditions, "actions": r.actions} for r in rules
    ]

    # Existing decisions (to avoid duplicates)
    existing_decisions = graph.decisions(db, project_id=project_id)
    decisions_data = [
        {"id": d.id, "name": d.name, "status": d.decision_status, "description": (d.description or "")[:200]}
        for d in existing_decisions
    ]

    return json.dumps(
        {
            "project": {"id": project.id, "name": project.name, "description": project.description},
            "tasks": tasks_data,
            "activity": activity_data,
            "comments": comments_data,
            "workflow_rules": rules_data,
            "existing_decisions": decisions_data,
        },
        default=str,
    )


def _tool_create_decision(db: Session, project_id: str, name: str, description: str) -> str:
    project = graph.get_project(db, project_id)
    if not project:
        return f"Project {project_id} not found"

    label = graph.create_label(
        db,
        project_id,
        name=name,
        color="#818cf8",
        type="decision",
        description=description,
        decision_status="proposed",
        source="ai",
    )
    db.commit()
    return json.dumps({"id": label.id, "name": label.name, "status": "proposed", "source": "ai"})


async def _tool_tag_task_with_decision(db: Session, task_id: str, decision_label_id: str, reason: str) -> str:
    import uuid

    task = graph.get_task(db, task_id)
    if not task:
        return f"Task {task_id} not found"

    label = graph.get_label(db, decision_label_id)
    if not label or label.type != "decision":
        return f"Decision label {decision_label_id} not found"

    # Add label to task if not already attached (idempotent)
    newly_tagged = decision_label_id not in graph.label_ids_for_task(db, task_id)
    graph.set_label(db, task_id, decision_label_id)

    # Add comment explaining the relevance
    comment = Comment(
        id=str(uuid.uuid4()),
        task_id=task_id,
        body=f"**Decision: {label.name}**\n\n{reason}",
        author="AI Assistant",
    )
    db.add(comment)
    if newly_tagged:
        await dispatch_edge_added(db, task_id, decision_label_id, graph.REL_LABELED, actor="assistant")
    else:
        db.commit()
    return json.dumps({"status": "tagged", "task_id": task_id, "decision": label.name, "reason": reason})


async def _tool_batch_create_tasks(db: Session, project_id: str, tasks: list[dict]) -> str:
    from app.services.ws_manager import ws_manager

    project = graph.get_project(db, project_id)
    if not project:
        return f"Project {project_id} not found"

    if not tasks:
        return "No tasks provided"
    if len(tasks) > 50:
        return "Maximum 50 tasks per batch"

    created_ids = []
    for item in tasks:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        if len(title) > 500:
            title = title[:500]

        due = None
        if item.get("due_date"):
            try:
                due = datetime.fromisoformat(item["due_date"])
            except (ValueError, TypeError):
                due = None
        task = graph.create_task(
            db,
            project_id=project_id,
            title=title,
            priority=item.get("priority", "medium"),
            description=item.get("description"),
            due_date=due,
        )
        await finalize_task_create(
            db, task.id, actor="assistant", source="assistant", project_id=project_id, commit=False, broadcast=False
        )
        created_ids.append(task.id)

        for sub in item.get("subtasks") or []:
            sub_title = (sub.get("title") or "").strip()
            if not sub_title:
                continue
            subtask = graph.create_task(
                db,
                project_id=project_id,
                title=sub_title,
                priority=sub.get("priority", "medium"),
                parent_id=task.id,
            )
            await finalize_task_create(
                db,
                subtask.id,
                actor="assistant",
                source="assistant",
                project_id=project_id,
                commit=False,
                broadcast=False,
            )
            created_ids.append(subtask.id)

    db.commit()

    try:
        await ws_manager.broadcast("task.imported", {"project_id": project_id, "count": len(created_ids)})
    except Exception:
        pass

    return json.dumps({"created": len(created_ids), "task_ids": created_ids})


# ── ADR-0102: task/project-domain tools closing the gap with MCP ────────


async def _tool_add_comment(db: Session, task_id: str, body: str) -> str:
    import uuid

    task = graph.get_task(db, task_id)
    if not task:
        return f"Task {task_id} not found"
    body = body.strip()
    if not body:
        return "Comment body must not be blank"
    project_id = graph.project_id_of_task(db, task_id)
    comment = Comment(id=str(uuid.uuid4()), task_id=task_id, project_id=project_id, body=body, author="assistant")
    db.add(comment)
    db.flush()
    log_activity(
        db, "comment.created", project_id=project_id, task_id=task_id, actor="assistant", detail="Comment added"
    )
    db.commit()
    try:
        await fire_notifications(db, task, "comment.created", source="assistant", actor="assistant")
    except Exception:
        pass
    return json.dumps({"id": comment.id, "task_id": task_id, "body": comment.body})


def _tool_list_comments(db: Session, task_id: str) -> str:
    comments = db.query(Comment).filter(Comment.task_id == task_id).order_by(Comment.created_at.asc()).all()
    return json.dumps(
        [
            {
                "id": c.id,
                "author": c.author,
                "body": c.body,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ]
    )


async def _tool_manage_dependencies(db: Session, action: str, task_id: str, depends_on_id: str | None = None) -> str:
    task = graph.get_task(db, task_id)
    if not task:
        return f"Task {task_id} not found"

    if action == "list":

        def _summaries(ids):
            rows = db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(ids)).all() if ids else []
            return [{"task_id": t.id, "title": t.title, "status": t.status} for t in rows]

        return json.dumps(
            {
                "blocked_by": _summaries(graph.prerequisite_ids(db, task_id)),
                "blocking": _summaries(graph.dependent_ids(db, task_id)),
            }
        )

    if not depends_on_id:
        return "depends_on_id is required for add/remove"
    if action == "add":
        if task_id == depends_on_id:
            return "A task cannot depend on itself"
        if not graph.get_task(db, depends_on_id):
            return f"Task {depends_on_id} not found"
        graph.add_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON)
        await dispatch_edge_added(db, task_id, depends_on_id, graph.REL_DEPENDS_ON, actor="assistant")
        return json.dumps({"status": "added", "task_id": task_id, "depends_on_id": depends_on_id})
    elif action == "remove":
        if graph.remove_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON):
            await dispatch_edge_removed(db, task_id, depends_on_id, graph.REL_DEPENDS_ON, actor="assistant")
        return json.dumps({"status": "removed", "task_id": task_id, "depends_on_id": depends_on_id})
    return f"Unknown dependency action: {action}"


def _tool_get_notifications(db: Session, unread_only: bool = True, limit: int = 20) -> str:
    q = db.query(Notification)
    if unread_only:
        q = q.filter(Notification.read.is_(False))
    notifs = q.order_by(Notification.created_at.desc()).limit(limit).all()
    return json.dumps(
        [
            {
                "id": n.id,
                "type": n.type,
                "message": n.message,
                "read": n.read,
                "link": n.link,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notifs
        ]
    )


def _tool_manage_notifications(db: Session, action: str, notification_id: str | None = None) -> str:
    if action == "unread_count":
        return json.dumps({"unread_count": db.query(Notification).filter(Notification.read.is_(False)).count()})
    if action == "read_all":
        db.query(Notification).filter(Notification.read.is_(False)).update({"read": True})
        db.commit()
        return json.dumps({"status": "all_read"})
    if not notification_id:
        return "notification_id is required for this action"
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        return f"Notification {notification_id} not found"
    if action == "read":
        notif.read = True
        db.commit()
        return json.dumps({"status": "read", "id": notification_id})
    elif action == "delete":
        db.delete(notif)
        db.commit()
        return json.dumps({"status": "deleted", "id": notification_id})
    return f"Unknown notification action: {action}"


def _tool_report_progress(
    db: Session,
    task_id: str,
    progress_pct: int | None = None,
    agent_notes: str | None = None,
    comment: str | None = None,
) -> str:
    """Bypasses apply_task_update on purpose — progress_pct/agent_notes are not status/
    priority, so the full rules/notification pipeline doesn't need to run for them,
    matching the v1 endpoint's own intentional behavior."""
    if graph.get_task(db, task_id) is None:
        return f"Task {task_id} not found"
    changes = {}
    if progress_pct is not None:
        changes["progress_pct"] = progress_pct
    if agent_notes is not None:
        changes["agent_notes"] = agent_notes
    if changes:
        graph.update_task(db, task_id, **changes)
    project_id = graph.project_id_of_task(db, task_id)
    if comment:
        import uuid

        db.add(Comment(id=str(uuid.uuid4()), task_id=task_id, project_id=project_id, body=comment, author="assistant"))
    log_activity(
        db,
        "task.progress_updated",
        project_id=project_id,
        task_id=task_id,
        actor="assistant",
        detail=f"Progress updated to {progress_pct}%" if progress_pct is not None else "Progress notes updated",
        meta={"progress_pct": progress_pct, "has_notes": agent_notes is not None, "has_comment": bool(comment)},
    )
    db.commit()
    return json.dumps({"task_id": task_id, "progress_pct": progress_pct})


def _project_summary(db: Session, p) -> dict:
    tasks = graph.subtree_task_views(db, p.id, top_level_only=True)
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "status": p.status,
        "total_tasks": total,
        "done_tasks": done,
        "progress": round(done / total * 100, 1) if total else 0.0,
    }


def _tool_list_projects(db: Session, status: str | None = None) -> str:
    return json.dumps([_project_summary(db, p) for p in graph.all_projects(db, status=status)])


async def _tool_create_project(db: Session, name: str, description: str | None = None) -> str:
    name = name.strip()
    if not name:
        return "Name must not be blank"
    project = graph.create_project(db, name=name, description=description, actor="assistant")
    node = db.get(Node, project.id)
    await dispatch_node_created(db, node, actor="assistant", source="assistant")
    return json.dumps({"id": project.id, "name": project.name})


def _tool_get_project_detail(db: Session, project_id: str) -> str:
    project = graph.get_project(db, project_id)
    if not project:
        return f"Project {project_id} not found"
    result = _project_summary(db, project)
    result["tasks"] = [
        {"id": t.id, "title": t.title, "status": t.status, "priority": t.priority, "assignee": t.assignee}
        for t in graph.tasks_in_project(db, project_id)
    ]
    return json.dumps(result, default=str)


async def _tool_delete_task(db: Session, task_id: str) -> str:
    node = db.get(Node, task_id)
    if not node or node.type not in graph.task_type_keys(db):
        return f"Task {task_id} not found"
    title = node.title
    await dispatch_node_deleted(db, node, actor="assistant", source="assistant")
    return json.dumps({"status": "deleted", "id": task_id, "title": title})


def _tool_get_container_subtree(db: Session, node_id: str) -> str:
    node = db.get(Node, node_id)
    if not node:
        return f"Node {node_id} not found"
    return json.dumps(enrich_container_subtree(node, db, visible=None).model_dump(), default=str)


async def _tool_bulk_update_tasks(db: Session, project_id: str, updates: list[dict]) -> str:
    allowed = {
        "title",
        "description",
        "status",
        "priority",
        "assignee",
        "due_date",
        "time_estimate",
        "time_spent",
        "parent_id",
    }
    contained = set(graph.contained_task_ids(db, project_id))
    updated_ids = []
    errors = []
    for update in updates:
        task_id = update.get("id")
        if not task_id:
            continue
        if task_id not in contained:
            errors.append(f"{task_id}: not in project {project_id}")
            continue
        changes = {}
        parent_id = _NOT_SET = object()
        for field, value in update.items():
            if field == "id" or field not in allowed:
                continue
            if field == "parent_id":
                parent_id = value
                continue
            if field == "title":
                value = (value or "").strip()[:500]
                if not value:
                    continue
            if field == "due_date" and value:
                value = (
                    datetime.fromisoformat(value)
                    if "T" in value
                    else datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
                )
            changes[field] = value
        if parent_id is not _NOT_SET and parent_id:
            try:
                graph.set_parent_task(db, task_id, parent_id)
            except ValueError as exc:
                errors.append(f"{task_id}: {exc}")
                continue
        if changes:
            await apply_task_update(
                db, task_id, changes, actor="assistant", source="assistant", project_id=project_id, broadcast=False
            )
        updated_ids.append(task_id)
    db.commit()
    return json.dumps({"updated": updated_ids, "errors": errors})


async def _tool_manage_unfiled(
    db: Session, action: str, task_id: str | None = None, project_id: str | None = None
) -> str:
    if action == "list":
        tasks = task_filing.list_unfiled(db)
        return json.dumps([{"id": t.id, "title": t.title, "status": t.status} for t in tasks], default=str)
    elif action == "file":
        if not task_id or not project_id:
            return "task_id and project_id are required for 'file'"
        try:
            task = await task_filing.file_into_project(db, task_id, project_id)
        except ServiceError as exc:
            return exc.detail
        return json.dumps({"id": task.id, "title": task.title})
    return f"Unknown unfiled action: {action}"


def _tool_get_graph_map(db: Session, types: str | None = None, limit: int = 500) -> str:
    """Never includes a node's raw ``data`` payload — that is where credentials
    (share tokens, webhook secrets) live, and there is no redaction middleware in this
    in-process path to strip them (ADR-0102)."""
    limit = min(limit or 500, 2000)
    q = db.query(Node)
    if types:
        keys = [k.strip() for k in types.split(",") if k.strip()]
        if keys:
            q = q.filter(Node.type.in_(keys))
    nodes = q.order_by(Node.created_at).limit(limit).all()
    ids = {n.id for n in nodes}
    edges = db.query(Edge).filter(Edge.source_id.in_(ids), Edge.target_id.in_(ids)).all() if ids else []
    return json.dumps(
        {
            "nodes": [
                {"id": n.id, "type": n.type, "title": n.title, "status": n.status, "priority": n.priority}
                for n in nodes
            ],
            "edges": [{"source_id": e.source_id, "target_id": e.target_id, "rel_type": e.rel_type} for e in edges],
        },
        default=str,
    )


def _tool_get_ancestry(db: Session, node_ids: list[str]) -> str:
    result = ancestry.ancestry_for(db, node_ids[: ancestry.MAX_IDS], visible=None)
    return json.dumps({k: v.model_dump() for k, v in result.items()}, default=str)


def _tool_list_decisions(db: Session, project_id: str | None = None, status: str | None = None) -> str:
    decisions = graph.decisions(db, project_id=project_id, status=status)
    return json.dumps(
        [
            {"id": d.id, "name": d.name, "status": d.decision_status, "description": (d.description or "")[:200]}
            for d in decisions
        ]
    )


def _tool_export_decision(db: Session, decision_id: str) -> str:
    try:
        md, filename = decision_admin.export_markdown(db, decision_id)
    except ServiceError as exc:
        return exc.detail
    return json.dumps({"filename": filename, "markdown": md})


async def _tool_manage_cycles(
    db: Session, action: str, project_id: str, cycle_id: str | None = None, compare_with: str | None = None
) -> str:
    try:
        if action == "list":
            return json.dumps([c.model_dump() for c in cycle_admin.list_cycles(db, project_id)], default=str)
        if not cycle_id:
            return "cycle_id is required for this action"
        if action == "get":
            return json.dumps(cycle_admin.get_cycle(db, project_id, cycle_id).model_dump(), default=str)
        elif action == "compare":
            if not compare_with:
                return "compare_with is required for 'compare'"
            return json.dumps(cycle_admin.compare(db, project_id, cycle_id, compare_with), default=str)
        elif action == "duplicate":
            return json.dumps((await cycle_admin.duplicate(db, project_id, cycle_id)).model_dump(), default=str)
        return f"Unknown cycle action: {action}"
    except ServiceError as exc:
        return exc.detail


def _tool_get_analytics(
    db: Session,
    report: str,
    project_id: str | None = None,
    cycle_id: str | None = None,
    raw_estimate: int | None = None,
) -> str:
    try:
        if report == "burndown":
            if not cycle_id:
                return "cycle_id is required for burndown"
            return json.dumps(analytics_admin.burndown(db, cycle_id), default=str)
        elif report == "cycle_burndown":
            if not cycle_id:
                return "cycle_id is required for cycle_burndown"
            return json.dumps(analytics_admin.cycle_burndown(db, cycle_id), default=str)
        elif report == "critical_path":
            if not project_id:
                return "project_id is required for critical_path"
            return json.dumps(analytics_admin.critical_path(db, project_id), default=str)
        elif report == "estimation_calibration":
            return json.dumps(analytics_admin.estimation_calibration(db, project_id=project_id), default=str)
        elif report == "estimate_suggestion":
            if raw_estimate is None:
                return "raw_estimate is required for estimate_suggestion"
            return json.dumps(analytics_admin.estimate_suggestion(db, raw_estimate, project_id=project_id), default=str)
        return f"Unknown report: {report}"
    except ServiceError as exc:
        return exc.detail


def _tool_manage_recurrence(db: Session, action: str, project_id: str, task_id: str, config: dict | None = None) -> str:
    try:
        if action == "get":
            rule = recurrence_admin.get(db, project_id, task_id)
        elif action == "create":
            if not config:
                return "config is required for 'create'"
            rule = recurrence_admin.create(db, project_id, task_id, RecurrenceRuleCreate(**config))
        elif action == "update":
            if not config:
                return "config is required for 'update'"
            rule = recurrence_admin.update(db, project_id, task_id, RecurrenceRuleUpdate(**config))
        elif action == "delete":
            recurrence_admin.delete(db, project_id, task_id)
            return json.dumps({"status": "deleted"})
        else:
            return f"Unknown recurrence action: {action}"
        return json.dumps(RecurrenceRuleOut.model_validate(rule).model_dump(), default=str)
    except ValidationError as exc:
        return f"Invalid config: {exc}"
    except ServiceError as exc:
        return exc.detail


def _tool_manage_templates(
    db: Session, action: str, template_id: str | None = None, project_id: str | None = None, config: dict | None = None
) -> str:
    def _out(t: TaskTemplate) -> dict:
        return {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "priority": t.priority,
            "subtasks": t.subtasks,
            "label_names": t.label_names,
            "project_id": t.project_id,
        }

    if action == "list":
        q = db.query(TaskTemplate)
        if project_id:
            q = q.filter((TaskTemplate.project_id == project_id) | (TaskTemplate.project_id.is_(None)))
        templates = q.order_by(TaskTemplate.created_at.desc()).all()
        return json.dumps([_out(t) for t in templates])
    elif action == "create":
        if not config or not config.get("name"):
            return "config with at least 'name' is required for 'create'"
        tpl = TaskTemplate(
            name=config["name"],
            description=config.get("description"),
            priority=config.get("priority", "medium"),
            subtasks=config.get("subtasks", []),
            label_names=config.get("label_names", []),
            project_id=config.get("project_id"),
        )
        db.add(tpl)
        db.commit()
        db.refresh(tpl)
        return json.dumps(_out(tpl))
    elif action in ("update", "delete"):
        if not template_id:
            return f"template_id is required for '{action}'"
        tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
        if not tpl:
            return f"Template {template_id} not found"
        if action == "delete":
            db.delete(tpl)
            db.commit()
            return json.dumps({"status": "deleted", "id": template_id})
        for field, value in (config or {}).items():
            if field in ("name", "description", "priority", "subtasks", "label_names", "project_id"):
                setattr(tpl, field, value)
        db.commit()
        db.refresh(tpl)
        return json.dumps(_out(tpl))
    return f"Unknown template action: {action}"


def _tool_manage_attachments(db: Session, action: str, task_id: str, attachment_id: str | None = None) -> str:
    project_id = graph.project_id_of_task(db, task_id)
    if not project_id:
        return f"Task {task_id} not found or not in a project"
    if action == "list":
        attachments = attachment_admin.list_for_task(db, project_id, task_id)
        return json.dumps(
            [
                {
                    "id": a.id,
                    "filename": a.filename,
                    "content_type": a.content_type,
                    "size": a.size,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
                for a in attachments
            ]
        )
    elif action == "delete":
        if not attachment_id:
            return "attachment_id is required for 'delete'"
        try:
            attachment_admin.delete(db, task_id, attachment_id)
        except ServiceError as exc:
            return exc.detail
        return json.dumps({"status": "deleted", "id": attachment_id})
    return f"Unknown attachment action: {action}"


async def _tool_import_tasks(db: Session, project_id: str, source: str, payload: dict) -> str:
    try:
        if source == "github":
            result = await task_import.import_github(db, project_id, GitHubImport(**payload))
        elif source == "linear":
            result = await task_import.import_linear(db, project_id, LinearImport(**payload))
        elif source == "trello":
            result = await task_import.import_trello(db, project_id, TrelloImport(**payload))
        else:
            return f"Unknown import source: {source}"
    except ValidationError as exc:
        return f"Invalid payload: {exc}"
    except ServiceError as exc:
        return exc.detail
    return json.dumps(result.model_dump())


async def _tool_transfer_tasks(db: Session, action: str, project_id: str, tasks: list[dict] | None = None) -> str:
    from app.services.ws_manager import ws_manager

    try:
        if action == "export":
            return json.dumps(task_transfer.export_rows(db, project_id), default=str)
        elif action == "import":
            if not tasks:
                return "tasks is required for 'import'"
            items = [TaskImportItem(**t) for t in tasks]
            created_ids = await task_transfer.import_tasks(db, project_id, items, actor="assistant")
            try:
                await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": created_ids})
            except Exception:
                pass
            return json.dumps({"created": len(created_ids), "task_ids": created_ids})
        return f"Unknown transfer action: {action}"
    except ValidationError as exc:
        return f"Invalid tasks payload: {exc}"
    except ServiceError as exc:
        return exc.detail
