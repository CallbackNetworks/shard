"""
Tool definitions and implementations for the LLM Assistant.
Each tool is a JSON schema (for the LLM) + a Python function (for execution).
"""
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models import Task, Project, ActivityLog, Label, TaskLabel, Cycle, CycleTask
from app.routers.projects import _enrich_task

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
                "status": {"type": "string", "enum": ["todo", "in_progress", "done", "failed"], "description": "Filter by status"},
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
            return _tool_update_task(db, **tool_input)
        elif tool_name == "update_task_status":
            # Backward compat alias
            return _tool_update_task(db, task_id=tool_input["task_id"], status=tool_input["status"])
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
        else:
            return f"Unknown tool: {tool_name}"
    except Exception as exc:
        return f"Tool error: {exc}"


async def _tool_get_summary(db: Session) -> str:
    projects = db.query(Project).filter(Project.status == "active").all()
    result = []
    for p in projects:
        total = len([t for t in p.tasks if t.parent_id is None])
        done = sum(1 for t in p.tasks if t.status == "done" and t.parent_id is None)
        in_prog = sum(1 for t in p.tasks if t.status == "in_progress" and t.parent_id is None)
        overdue = sum(1 for t in p.tasks if t.due_date and t.due_date < datetime.now(timezone.utc) and t.status not in ("done", "failed"))
        result.append({
            "id": p.id,
            "name": p.name,
            "total": total, "done": done, "in_progress": in_prog, "overdue": overdue,
            "progress": f"{round(done/total*100,1) if total else 0}%",
        })
    return json.dumps(result, default=str)


def _tool_list_tasks(db: Session, project_id: str, status: str | None = None) -> str:
    q = db.query(Task).filter(Task.project_id == project_id)
    if status:
        q = q.filter(Task.status == status)
    tasks = q.order_by(Task.created_at.desc()).limit(50).all()
    return json.dumps([{
        "id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
        "assignee": t.assignee, "due_date": t.due_date.isoformat() if t.due_date else None,
    } for t in tasks], default=str)


async def _tool_create_task(db: Session, project_id: str, title: str, priority: str = "medium", description: str | None = None, assignee: str | None = None, due_date: str | None = None) -> str:
    import uuid
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return f"Project {project_id} not found"
    task = Task(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title=title,
        priority=priority,
        description=description,
        assignee=assignee,
        callback_token=str(uuid.uuid4()),
    )
    if due_date:
        task.due_date = datetime.strptime(due_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    db.add(task)
    db.commit()
    return json.dumps({"id": task.id, "title": task.title, "status": task.status})


def _tool_update_task(db: Session, task_id: str, **kwargs) -> str:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        return f"Task {task_id} not found"
    updatable = ("status", "priority", "title", "description", "assignee", "time_estimate", "time_spent")
    for field in updatable:
        if field in kwargs and kwargs[field] is not None:
            setattr(task, field, kwargs[field])
    if "due_date" in kwargs:
        val = kwargs["due_date"]
        if val and val != "null":
            task.due_date = datetime.fromisoformat(val).replace(tzinfo=timezone.utc) if "T" in val else datetime.strptime(val, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        else:
            task.due_date = None
    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    return json.dumps({"id": task.id, "title": task.title, "status": task.status, "priority": task.priority, "due_date": task.due_date.isoformat() if task.due_date else None})


async def _tool_create_subtask(db: Session, parent_task_id: str, title: str, priority: str = "medium") -> str:
    import uuid
    parent = db.query(Task).filter(Task.id == parent_task_id).first()
    if not parent:
        return f"Parent task {parent_task_id} not found"
    task = Task(
        id=str(uuid.uuid4()),
        project_id=parent.project_id,
        title=title,
        priority=priority,
        parent_id=parent_task_id,
        callback_token=str(uuid.uuid4()),
    )
    db.add(task)
    db.commit()
    return json.dumps({"id": task.id, "title": task.title, "parent_id": parent_task_id})


def _tool_manage_labels(db: Session, action: str, project_id: str | None = None, task_id: str | None = None, label_id: str | None = None) -> str:
    if action == "list":
        if not project_id:
            return "project_id required for list action"
        labels = db.query(Label).filter(Label.project_id == project_id).all()
        return json.dumps([{"id": l.id, "name": l.name, "color": l.color} for l in labels])
    elif action == "add":
        if not task_id or not label_id:
            return "task_id and label_id required for add action"
        existing = db.query(TaskLabel).filter(TaskLabel.task_id == task_id, TaskLabel.label_id == label_id).first()
        if existing:
            return "Label already assigned"
        db.add(TaskLabel(task_id=task_id, label_id=label_id))
        db.commit()
        return json.dumps({"status": "added", "task_id": task_id, "label_id": label_id})
    elif action == "remove":
        if not task_id or not label_id:
            return "task_id and label_id required for remove action"
        tl = db.query(TaskLabel).filter(TaskLabel.task_id == task_id, TaskLabel.label_id == label_id).first()
        if tl:
            db.delete(tl)
            db.commit()
        return json.dumps({"status": "removed", "task_id": task_id, "label_id": label_id})
    return f"Unknown label action: {action}"


def _tool_analyze_workload(db: Session, project_id: str | None = None) -> str:
    q = db.query(Task).filter(Task.parent_id == None)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    tasks = q.all()

    now = datetime.now(timezone.utc)
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

    return json.dumps({
        "total_tasks": len(tasks),
        "by_status": by_status,
        "by_priority": by_priority,
        "by_assignee": by_assignee,
        "overdue": overdue,
        "total_estimate_hours": round(total_estimate / 60, 1),
        "total_spent_hours": round(total_spent / 60, 1),
    })


def _tool_search(db: Session, query: str) -> str:
    from sqlalchemy import or_
    q = query.lower()
    tasks = db.query(Task).filter(
        or_(Task.title.ilike(f"%{q}%"), Task.description.ilike(f"%{q}%"))
    ).limit(20).all()
    projects = db.query(Project).filter(
        or_(Project.name.ilike(f"%{q}%"), Project.description.ilike(f"%{q}%"))
    ).limit(10).all()
    return json.dumps({
        "tasks": [{"id": t.id, "title": t.title, "status": t.status, "project_id": t.project_id} for t in tasks],
        "projects": [{"id": p.id, "name": p.name} for p in projects],
    })


def _tool_get_activity(db: Session, limit: int = 20) -> str:
    logs = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return json.dumps([{
        "action": l.action, "detail": l.detail, "actor": l.actor,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in logs], default=str)
