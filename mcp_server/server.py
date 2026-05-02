#!/usr/bin/env python3
"""MCP server exposing TODO Platform task management tools via stdio transport."""

import asyncio
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

DB_PATH = os.environ.get("DB_PATH", "/app/backend/todo_platform.db")

server = Server("todo-platform")


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_dict(row) -> dict:
    return dict(row) if row else {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Tool implementations ──────────────────────────────────────────────────────

def _get_summary() -> str:
    with get_db() as conn:
        projects = conn.execute(
            "SELECT id, name, status FROM projects WHERE status = 'active'"
        ).fetchall()
        result = []
        for p in projects:
            pid = p["id"]
            total = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id=? AND parent_id IS NULL", (pid,)
            ).fetchone()[0]
            done = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id=? AND parent_id IS NULL AND status='done'", (pid,)
            ).fetchone()[0]
            in_prog = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id=? AND parent_id IS NULL AND status='in_progress'", (pid,)
            ).fetchone()[0]
            overdue = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id=? AND due_date IS NOT NULL"
                " AND due_date < ? AND status NOT IN ('done','failed')",
                (pid, _now_iso()),
            ).fetchone()[0]
            result.append({
                "id": pid,
                "name": p["name"],
                "total": total,
                "done": done,
                "in_progress": in_prog,
                "overdue": overdue,
                "progress": f"{round(done / total * 100, 1) if total else 0}%",
            })
        return json.dumps(result)


def _list_tasks(project_id: str, status: str | None = None) -> str:
    with get_db() as conn:
        sql = "SELECT id, title, status, priority, assignee, due_date FROM tasks WHERE project_id=?"
        params: list = [project_id]
        if status:
            sql += " AND status=?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT 50"
        rows = conn.execute(sql, params).fetchall()
        return json.dumps([dict(r) for r in rows])


def _create_task(
    project_id: str,
    title: str,
    priority: str = "medium",
    description: str | None = None,
    assignee: str | None = None,
    due_date: str | None = None,
) -> str:
    task_id = str(uuid.uuid4())
    token = str(uuid.uuid4())
    now = _now_iso()
    parsed_due = None
    if due_date:
        try:
            parsed_due = datetime.strptime(due_date, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            parsed_due = due_date

    with get_db() as conn:
        project = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not project:
            return f"Project {project_id} not found"
        conn.execute(
            "INSERT INTO tasks (id, project_id, title, priority, description, assignee, due_date,"
            " callback_token, status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,'todo',?,?)",
            (task_id, project_id, title, priority, description, assignee, parsed_due, token, now, now),
        )
        return json.dumps({"id": task_id, "title": title, "status": "todo"})


def _update_task(task_id: str, **kwargs) -> str:
    updatable = ("status", "priority", "title", "description", "assignee", "time_estimate", "time_spent")
    with get_db() as conn:
        row = conn.execute("SELECT id, title, status, priority, due_date FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            return f"Task {task_id} not found"

        sets = []
        params = []
        for field in updatable:
            if field in kwargs and kwargs[field] is not None:
                sets.append(f"{field}=?")
                params.append(kwargs[field])

        if "due_date" in kwargs:
            val = kwargs["due_date"]
            sets.append("due_date=?")
            if val and val not in ("null", ""):
                try:
                    parsed = (
                        datetime.fromisoformat(val).replace(tzinfo=timezone.utc).isoformat()
                        if "T" in val
                        else datetime.strptime(val, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
                    )
                except ValueError:
                    parsed = val
                params.append(parsed)
            else:
                params.append(None)

        if sets:
            sets.append("updated_at=?")
            params.append(_now_iso())
            params.append(task_id)
            conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", params)

        updated = conn.execute(
            "SELECT id, title, status, priority, due_date FROM tasks WHERE id=?", (task_id,)
        ).fetchone()
        return json.dumps(dict(updated))


def _create_subtask(parent_task_id: str, title: str, priority: str = "medium") -> str:
    task_id = str(uuid.uuid4())
    token = str(uuid.uuid4())
    now = _now_iso()
    with get_db() as conn:
        parent = conn.execute(
            "SELECT id, project_id FROM tasks WHERE id=?", (parent_task_id,)
        ).fetchone()
        if not parent:
            return f"Parent task {parent_task_id} not found"
        conn.execute(
            "INSERT INTO tasks (id, project_id, parent_id, title, priority, callback_token,"
            " status, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,'todo',?,?)",
            (task_id, parent["project_id"], parent_task_id, title, priority, token, now, now),
        )
        return json.dumps({"id": task_id, "title": title, "parent_id": parent_task_id})


def _manage_labels(
    action: str,
    project_id: str | None = None,
    task_id: str | None = None,
    label_id: str | None = None,
) -> str:
    with get_db() as conn:
        if action == "list":
            if not project_id:
                return "project_id required for list action"
            rows = conn.execute(
                "SELECT id, name, color FROM labels WHERE project_id=?", (project_id,)
            ).fetchall()
            return json.dumps([dict(r) for r in rows])

        if action == "add":
            if not task_id or not label_id:
                return "task_id and label_id required for add action"
            exists = conn.execute(
                "SELECT 1 FROM task_labels WHERE task_id=? AND label_id=?", (task_id, label_id)
            ).fetchone()
            if exists:
                return "Label already assigned"
            conn.execute(
                "INSERT INTO task_labels (task_id, label_id) VALUES (?,?)", (task_id, label_id)
            )
            return json.dumps({"status": "added", "task_id": task_id, "label_id": label_id})

        if action == "remove":
            if not task_id or not label_id:
                return "task_id and label_id required for remove action"
            conn.execute(
                "DELETE FROM task_labels WHERE task_id=? AND label_id=?", (task_id, label_id)
            )
            return json.dumps({"status": "removed", "task_id": task_id, "label_id": label_id})

        return f"Unknown label action: {action}"


def _analyze_workload(project_id: str | None = None) -> str:
    with get_db() as conn:
        sql = "SELECT status, priority, assignee, due_date, time_estimate, time_spent FROM tasks WHERE parent_id IS NULL"
        params: list = []
        if project_id:
            sql += " AND project_id=?"
            params.append(project_id)
        rows = conn.execute(sql, params).fetchall()

        now = _now_iso()
        by_status: dict = {}
        by_priority: dict = {}
        by_assignee: dict = {}
        overdue = 0
        total_estimate = 0
        total_spent = 0

        for r in rows:
            status = r["status"]
            priority = r["priority"]
            assignee = r["assignee"] or "(unassigned)"
            by_status[status] = by_status.get(status, 0) + 1
            by_priority[priority] = by_priority.get(priority, 0) + 1
            if assignee not in by_assignee:
                by_assignee[assignee] = {"total": 0, "done": 0, "in_progress": 0}
            by_assignee[assignee]["total"] += 1
            if status == "done":
                by_assignee[assignee]["done"] += 1
            elif status == "in_progress":
                by_assignee[assignee]["in_progress"] += 1
            if r["due_date"] and r["due_date"] < now and status not in ("done", "failed"):
                overdue += 1
            if r["time_estimate"]:
                total_estimate += r["time_estimate"]
            if r["time_spent"]:
                total_spent += r["time_spent"]

        return json.dumps({
            "total_tasks": len(rows),
            "by_status": by_status,
            "by_priority": by_priority,
            "by_assignee": by_assignee,
            "overdue": overdue,
            "total_estimate_hours": round(total_estimate / 60, 1),
            "total_spent_hours": round(total_spent / 60, 1),
        })


def _search(query: str) -> str:
    like = f"%{query.lower()}%"
    with get_db() as conn:
        tasks = conn.execute(
            "SELECT id, title, status, project_id FROM tasks"
            " WHERE lower(title) LIKE ? OR lower(description) LIKE ? LIMIT 20",
            (like, like),
        ).fetchall()
        projects = conn.execute(
            "SELECT id, name FROM projects"
            " WHERE lower(name) LIKE ? OR lower(description) LIKE ? LIMIT 10",
            (like, like),
        ).fetchall()
        return json.dumps({
            "tasks": [dict(r) for r in tasks],
            "projects": [dict(r) for r in projects],
        })


def _get_activity(limit: int = 20) -> str:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT action, detail, actor, created_at FROM activity_logs"
            " ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return json.dumps([dict(r) for r in rows])


# ── MCP tool registry ─────────────────────────────────────────────────────────

TOOL_DEFINITIONS = [
    types.Tool(
        name="get_summary",
        description="Get a high-level summary of all active projects and their task counts, progress, and overdue items.",
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
                "project_id": {"type": "string"},
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
                "task_id": {"type": "string"},
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
    ),
    types.Tool(
        name="create_subtask",
        description="Create a subtask under an existing task.",
        inputSchema={
            "type": "object",
            "properties": {
                "parent_task_id": {"type": "string"},
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"]},
            },
            "required": ["parent_task_id", "title"],
        },
    ),
    types.Tool(
        name="manage_labels",
        description="Add or remove a label from a task, or list labels for a project.",
        inputSchema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "remove"]},
                "project_id": {"type": "string", "description": "Required for list"},
                "task_id": {"type": "string", "description": "Required for add/remove"},
                "label_id": {"type": "string", "description": "Required for add/remove"},
            },
            "required": ["action"],
        },
    ),
    types.Tool(
        name="analyze_workload",
        description="Analyze workload: tasks by status, priority, assignee, and overdue count.",
        inputSchema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Optional; all projects if omitted"},
            },
            "required": [],
        },
    ),
    types.Tool(
        name="search",
        description="Search for tasks and projects by keyword.",
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
        description="Get recent activity log entries.",
        inputSchema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of entries (default 20)"},
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
            result = _get_summary()
        elif name == "list_tasks":
            result = _list_tasks(**args)
        elif name == "create_task":
            result = _create_task(**args)
        elif name == "update_task":
            result = _update_task(**args)
        elif name == "create_subtask":
            result = _create_subtask(**args)
        elif name == "manage_labels":
            result = _manage_labels(**args)
        elif name == "analyze_workload":
            result = _analyze_workload(args.get("project_id"))
        elif name == "search":
            result = _search(args.get("query", ""))
        elif name == "get_activity":
            result = _get_activity(args.get("limit", 20))
        else:
            result = f"Unknown tool: {name}"
    except Exception as exc:
        result = f"Tool error: {exc}"

    return [types.TextContent(type="text", text=result)]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
