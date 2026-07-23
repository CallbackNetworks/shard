"""
Tool definitions and implementations for the LLM Assistant.
Each tool is a JSON schema (for the LLM) + a Python function (for execution).
"""

import json
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import ActivityLog, Comment, Node, WorkflowRule
from app.services import graph
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
            return _tool_manage_labels(db, **tool_input)
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
            return _tool_tag_task_with_decision(db, **tool_input)
        elif tool_name == "batch_create_tasks":
            return await _tool_batch_create_tasks(db, **tool_input)
        else:
            return f"Unknown tool: {tool_name}"
    except Exception as exc:
        return f"Tool error: {exc}"


async def _tool_get_summary(db: Session) -> str:
    projects = graph.all_projects(db, status="active")
    result = []
    for p in projects:
        p_tasks = graph.tasks_in_project(db, p.id)
        sub = graph.subtask_ids_among(db, [t.id for t in p_tasks])
        total = len([t for t in p_tasks if t.id not in sub])
        done = sum(1 for t in p_tasks if t.status == "done" and t.id not in sub)
        in_prog = sum(1 for t in p_tasks if t.status == "in_progress" and t.id not in sub)
        overdue = sum(
            1 for t in p_tasks if t.due_date and t.due_date < datetime.now(UTC) and t.status not in ("done", "failed")
        )
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
    q = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.id.in_(graph.contained_task_ids(db, project_id)))
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


def _tool_manage_labels(
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
        db.commit()
        return json.dumps({"status": "added", "task_id": task_id, "label_id": label_id})
    elif action == "remove":
        if not task_id or not label_id:
            return "task_id and label_id required for remove action"
        if graph.unset_label(db, task_id, label_id):
            db.commit()
        return json.dumps({"status": "removed", "task_id": task_id, "label_id": label_id})
    return f"Unknown label action: {action}"


def _tool_analyze_workload(db: Session, project_id: str | None = None) -> str:
    q = db.query(Node).filter(Node.type == graph.NODE_TASK, graph.top_level_task_filter(db))
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
        if t.due_date and t.due_date < now and t.status not in ("done", "failed"):
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
        for n in db.query(Node).filter(Node.type == graph.NODE_TASK).all()
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
        .filter(Node.type == graph.NODE_TASK, Node.id.in_(graph.contained_task_ids(db, project_id)))
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


def _tool_tag_task_with_decision(db: Session, task_id: str, decision_label_id: str, reason: str) -> str:
    import uuid

    task = graph.get_task(db, task_id)
    if not task:
        return f"Task {task_id} not found"

    label = graph.get_label(db, decision_label_id)
    if not label or label.type != "decision":
        return f"Decision label {decision_label_id} not found"

    # Add label to task if not already attached (idempotent)
    graph.set_label(db, task_id, decision_label_id)

    # Add comment explaining the relevance
    comment = Comment(
        id=str(uuid.uuid4()),
        task_id=task_id,
        body=f"**Decision: {label.name}**\n\n{reason}",
        author="AI Assistant",
    )
    db.add(comment)
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
