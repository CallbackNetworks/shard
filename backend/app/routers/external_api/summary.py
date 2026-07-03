"""
External API v1 — Summary endpoint for AI agents.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, ApiKey, Identity, Project
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import SummaryOut

sub_router = APIRouter()


@sub_router.get(
    "/summary",
    summary="Platform summary for AI agents",
    description="""High-level platform summary optimized for LLM/AI agent consumption.

Returns a comprehensive snapshot including:
- Overall stats (total projects, tasks, completion rate)
- Per-identity breakdown (tasks, progress, linked projects)
- Per-project breakdown (active tasks, assignees, next deadline)
- Recent activity log (last 20 entries)

This is the recommended first endpoint to call when an AI agent needs to understand the current state of all work. Requires `read` scope.""",
    response_model=SummaryOut,
    responses=_auth_errors,
)
def api_summary(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")

    now = datetime.now(UTC)

    query = db.query(Project)
    if api_key.project_id:
        query = query.filter(Project.id == api_key.project_id)
    projects = query.order_by(Project.created_at.desc()).all()

    total_projects = len(projects)
    active_projects = sum(1 for p in projects if p.status == "active")
    total_tasks_all = 0
    total_done_all = 0
    total_overdue = 0
    project_summaries = []

    for p in projects:
        tasks = p.tasks
        total = len(tasks)
        done = 0
        in_progress = 0
        failed = 0
        todo = 0
        overdue = 0
        active_tasks = []
        todo_tasks = []
        assignees_set = set()
        next_due = None

        priority_order = {"high": 0, "medium": 1, "low": 2}

        for t in tasks:
            if t.status == "done":
                done += 1
            elif t.status == "in_progress":
                in_progress += 1
            elif t.status == "failed":
                failed += 1
            elif t.status == "todo":
                todo += 1
                todo_tasks.append(
                    {
                        "id": t.id,
                        "title": t.title,
                        "status": t.status,
                        "priority": t.priority,
                        "assignee": t.assignee,
                        "due_date": t.due_date.isoformat() if t.due_date else None,
                    }
                )

            is_overdue = t.due_date and t.due_date.replace(tzinfo=None) < now.replace(tzinfo=None) and t.status not in ("done", "failed")
            if is_overdue:
                overdue += 1

            if t.status == "in_progress" or is_overdue:
                active_tasks.append(
                    {
                        "id": t.id,
                        "title": t.title,
                        "status": t.status,
                        "priority": t.priority,
                        "assignee": t.assignee,
                        "due_date": t.due_date.isoformat() if t.due_date else None,
                    }
                )

            if t.assignee:
                assignees_set.add(t.assignee)

            if (
                t.due_date
                and t.due_date.replace(tzinfo=None) >= now.replace(tzinfo=None)
                and t.status not in ("done", "failed")
                and (next_due is None or t.due_date < next_due)
            ):
                next_due = t.due_date

        total_tasks_all += total
        total_done_all += done
        total_overdue += overdue

        # Sort todo tasks by priority (high first) and take top 10
        todo_tasks.sort(key=lambda x: priority_order.get(x["priority"], 2))

        project_summaries.append(
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "progress": f"{round(done / total * 100, 1)}%" if total > 0 else "0%",
                "total_tasks": total,
                "done": done,
                "in_progress": in_progress,
                "failed": failed,
                "todo": todo,
                "overdue": overdue,
                "next_due": next_due.isoformat() if next_due else None,
                "assignees": list(assignees_set),
                "active_tasks": active_tasks,
                "todo_tasks": todo_tasks[:10],
            }
        )

    # Recent activity
    activity_query = db.query(ActivityLog).order_by(ActivityLog.created_at.desc())
    if api_key.project_id:
        activity_query = activity_query.filter(ActivityLog.project_id == api_key.project_id)
    recent = activity_query.limit(20).all()

    def _time_ago(dt):
        if not dt:
            return ""
        delta = now - dt.replace(tzinfo=UTC) if dt.tzinfo is None else now - dt
        secs = int(delta.total_seconds())
        if secs < 60:
            return f"{secs}s ago"
        mins = secs // 60
        if mins < 60:
            return f"{mins}m ago"
        hours = mins // 60
        if hours < 24:
            return f"{hours}h ago"
        days = hours // 24
        return f"{days}d ago"

    recent_activity = [
        {
            "action": a.action,
            "detail": a.detail,
            "actor": a.actor,
            "when": _time_ago(a.created_at),
            "timestamp": a.created_at.isoformat() if a.created_at else None,
        }
        for a in recent
    ]

    # Identity grouping
    all_identities = db.query(Identity).order_by(Identity.created_at.asc()).all()
    identity_summaries = []
    for ident in all_identities:
        ident_project_ids = {pi.project_id for pi in ident.project_identities}
        ident_projects = [ps for ps in project_summaries if ps["id"] in ident_project_ids]
        if not ident_projects:
            identity_summaries.append(
                {
                    "id": ident.id,
                    "name": ident.name,
                    "color": ident.color,
                    "avatar": ident.avatar,
                    "total_tasks": 0,
                    "done": 0,
                    "in_progress": 0,
                    "overdue": 0,
                    "projects": [],
                }
            )
            continue
        identity_summaries.append(
            {
                "id": ident.id,
                "name": ident.name,
                "color": ident.color,
                "avatar": ident.avatar,
                "total_tasks": sum(p["total_tasks"] for p in ident_projects),
                "done": sum(p["done"] for p in ident_projects),
                "in_progress": sum(p["in_progress"] for p in ident_projects),
                "overdue": sum(p["overdue"] for p in ident_projects),
                "projects": [{"id": p["id"], "name": p["name"], "progress": p["progress"]} for p in ident_projects],
            }
        )

    return {
        "timestamp": now.isoformat(),
        "total_projects": total_projects,
        "active_projects": active_projects,
        "total_tasks": total_tasks_all,
        "total_done": total_done_all,
        "overall_progress": f"{round(total_done_all / total_tasks_all * 100, 1)}%" if total_tasks_all > 0 else "0%",
        "overdue_tasks": total_overdue,
        "identities": identity_summaries,
        "projects": project_summaries,
        "recent_activity": recent_activity,
    }
