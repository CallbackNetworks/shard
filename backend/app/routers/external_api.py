"""
External API v1 — authenticated with API keys.

All endpoints require an `X-API-Key` header.
Scopes: read (GET), write (POST/PATCH/DELETE), admin (all).
"""
import hashlib
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from sqlalchemy import func, cast, Date
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ApiKey, Project, Task, Integration, ActivityLog, Identity,
    Comment, Label, TaskLabel, TaskDependency, Notification, Cycle, CycleTask,
)
from app.schemas import (
    ProjectCreate, ProjectUpdate, ProjectOut,
    TaskCreate, TaskUpdate, TaskOut,
    WebhookCallback,
    ProjectStatsOut, EmailStatusOut, EmailSendRequest, EmailSendOut,
    SummaryOut, ActivityEntryOut,
    CommentCreate, CommentUpdate, CommentOut,
    LabelCreate, LabelOut,
    NotificationOut,
)
from app.services.notifier import fire_notifications
from app.services.activity import log_activity
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api/v1", tags=["External API v1"])


# ── Auth dependency ───────────────────────────────────────────────

def _get_api_key(
    x_api_key: str = Header(..., alias="X-API-Key", description="API key (starts with tdp_). Create one in the API Keys page."),
    db: Session = Depends(get_db),
) -> ApiKey:
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    api_key = db.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.active == True).first()
    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    api_key.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return api_key


def _require_scope(api_key: ApiKey, scope: str):
    if "admin" in api_key.scopes:
        return
    if scope not in api_key.scopes:
        raise HTTPException(status_code=403, detail=f"API key missing '{scope}' scope")


def _check_project_access(api_key: ApiKey, project_id: str):
    if api_key.project_id and api_key.project_id != project_id:
        raise HTTPException(status_code=403, detail="API key does not have access to this project")


def _enrich_project(project: Project) -> dict:
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    return {
        **{c.name: getattr(project, c.name) for c in project.__table__.columns},
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "total_tasks": total,
        "done_tasks": done,
        "tasks": [],
        "labels": [],
        "cycles": [],
    }


_auth_errors = {
    401: {"description": "Invalid or inactive API key"},
    403: {"description": "Insufficient scope or project access denied"},
}


def _get_task_or_404(project_id: str, task_id: str, db: Session) -> Task:
    """Shared helper: validate task exists within the given project."""
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _enrich_task_for_search(task: Task) -> dict:
    """Attach labels, counts, and dependency IDs to a TaskOut dict."""
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by = [d.depends_on_id for d in task.blocked_by_deps]
    out.blocking = [d.task_id for d in task.blocking_deps]
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()


# ── Projects ──────────────────────────────────────────────────────

@router.get(
    "/projects",
    summary="List all projects",
    description="Returns all projects accessible to this API key. If the key is scoped to a single project, only that project is returned. Each project includes progress stats (done/total tasks). Requires `read` scope.",
    responses=_auth_errors,
)
def api_list_projects(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    query = db.query(Project)
    if api_key.project_id:
        query = query.filter(Project.id == api_key.project_id)
    projects = query.order_by(Project.created_at.desc()).all()
    return [_enrich_project(p) for p in projects]


@router.get(
    "/projects/{project_id}",
    summary="Get a project with all its tasks",
    description="Returns a single project with full task list. Requires `read` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_get_project(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    result = _enrich_project(project)
    result["tasks"] = [
        {c.name: getattr(t, c.name) for c in t.__table__.columns}
        for t in project.tasks
    ]
    return result


@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new project",
    description="Creates a new project. Requires `write` scope.",
    responses=_auth_errors,
)
def api_create_project(
    body: ProjectCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    project = Project(**body.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return _enrich_project(project)


@router.patch(
    "/projects/{project_id}",
    summary="Update a project",
    description="Partially updates a project's name, description, or status. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_update_project(
    project_id: str,
    body: ProjectUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return _enrich_project(project)


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project",
    description="Permanently deletes a project and all its tasks. Requires `admin` scope.",
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()


# ── Tasks ─────────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/tasks",
    summary="List tasks in a project",
    description="Returns tasks for a project, optionally filtered by status and/or priority. Requires `read` scope.",
    response_model=list[TaskOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_list_tasks(
    project_id: str,
    status_filter: str | None = Query(None, description="Filter by status: todo, in_progress, done, or failed"),
    priority: str | None = Query(None, description="Filter by priority: low, medium, or high"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    query = db.query(Task).filter(Task.project_id == project_id)
    if status_filter:
        query = query.filter(Task.status == status_filter)
    if priority:
        query = query.filter(Task.priority == priority)
    return query.order_by(Task.created_at.asc()).all()


@router.get(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Get a single task",
    description="Returns a single task by ID within a project. Requires `read` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_get_task(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post(
    "/projects/{project_id}/tasks",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new task",
    description="Creates a task in a project. The task gets a unique `callback_token` for CI/CD webhook integration. Requires `write` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_create_task(
    project_id: str,
    body: TaskCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task = Task(project_id=project_id, **body.model_dump())
    db.add(task)
    db.flush()
    log_activity(
        db, "task.created",
        project_id=project_id, task_id=task.id,
        actor=f"api:{api_key.name}",
        detail=f'Task "{task.title}" created via API',
        meta={"title": task.title, "priority": task.priority, "api_key": api_key.name},
    )
    db.commit()
    db.refresh(task)
    return task


@router.patch(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Update a task",
    description="Partially updates a task. When status changes, outbound notifications are fired to matching integrations. Requires `write` scope.",
    response_model=TaskOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
async def api_update_task(
    project_id: str,
    task_id: str,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    old_status = task.status
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(task, field, value)

    if body.status and body.status != old_status:
        log_activity(
            db, "task.status_changed",
            project_id=project_id, task_id=task_id,
            actor=f"api:{api_key.name}",
            detail=f'Task "{task.title}" changed from {old_status} to {body.status} via API',
            meta={"old_status": old_status, "new_status": body.status, "api_key": api_key.name},
        )

    db.commit()
    db.refresh(task)

    # Fire notifications on status change
    if body.status and body.status != old_status:
        event = f"task.{body.status}"
        await fire_notifications(db, task, event)
        if body.status == "done":
            project = task.project
            if all(t.status == "done" for t in project.tasks):
                await fire_notifications(db, task, "project.complete")

    return task


@router.delete(
    "/projects/{project_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a task",
    description="Permanently deletes a task. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_delete_task(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


# ── Bulk operations ───────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/tasks/bulk",
    summary="Bulk create tasks",
    description="Creates multiple tasks in one request. Returns the list of created tasks. Requires `write` scope.",
    response_model=list[TaskOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
async def api_bulk_create_tasks(
    project_id: str,
    tasks: list[TaskCreate],
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    created = []
    for body in tasks:
        task = Task(project_id=project_id, **body.model_dump())
        db.add(task)
        created.append(task)
    db.commit()
    for t in created:
        db.refresh(t)
    return created


@router.post(
    "/projects/{project_id}/tasks/bulk-update",
    summary="Bulk update tasks",
    description="Updates multiple tasks in one request. Each item needs an `id` field and the fields to update. Status changes trigger notifications. Requires `write` scope.",
    responses={**_auth_errors},
)
async def api_bulk_update_tasks(
    project_id: str,
    updates: list[dict],
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    """Bulk update tasks. Each item needs 'id' and fields to update."""
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    results = []
    for update in updates:
        task_id = update.pop("id", None)
        if not task_id:
            continue
        task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
        if not task:
            continue
        old_status = task.status
        for field, value in update.items():
            if hasattr(task, field):
                setattr(task, field, value)
        results.append(task)

        if "status" in update and update["status"] != old_status:
            event = f"task.{update['status']}"
            await fire_notifications(db, task, event)

    db.commit()
    for t in results:
        db.refresh(t)
    return results


# ── Project stats ─────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/stats",
    summary="Get project statistics",
    description="Returns task counts by status and priority, completion percentage, and overdue count. Requires `read` scope.",
    response_model=ProjectStatsOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_project_stats(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = project.tasks
    total = len(tasks)
    by_status = {}
    by_priority = {}
    overdue = 0
    now = datetime.now(timezone.utc)

    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        by_priority[t.priority] = by_priority.get(t.priority, 0) + 1
        if t.due_date and t.due_date < now and t.status not in ("done", "failed"):
            overdue += 1

    done = by_status.get("done", 0)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "total_tasks": total,
        "done_tasks": done,
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "by_status": by_status,
        "by_priority": by_priority,
        "overdue_tasks": overdue,
    }


# ── Email config status ──────────────────────────────────────────

@router.get(
    "/email/status",
    summary="Check SMTP configuration status",
    description="Returns whether SMTP email sending is configured and the current settings. Requires `read` scope.",
    response_model=EmailStatusOut,
    responses=_auth_errors,
)
def api_email_status(api_key: ApiKey = Depends(_get_api_key)):
    from app.services.email_sender import is_configured, SMTP_HOST, SMTP_PORT, SMTP_FROM
    _require_scope(api_key, "read")
    return {
        "configured": is_configured(),
        "smtp_host": SMTP_HOST or None,
        "smtp_port": SMTP_PORT,
        "smtp_from": SMTP_FROM or None,
    }


# ── Send email directly ──────────────────────────────────────────

@router.post(
    "/email/send",
    summary="Send an email directly",
    description="Sends an email to specified recipients. SMTP must be configured. Requires `write` scope.",
    response_model=EmailSendOut,
    responses={**_auth_errors, 502: {"description": "Failed to send email"}, 503: {"description": "SMTP not configured"}},
)
def api_send_email(
    email: EmailSendRequest,
    api_key: ApiKey = Depends(_get_api_key),
):
    from app.services.email_sender import send_email, is_configured
    _require_scope(api_key, "write")
    if not is_configured():
        raise HTTPException(status_code=503, detail="SMTP not configured")
    if email.html:
        ok = send_email(email.to, email.subject, email.body)
    else:
        ok = send_email(email.to, email.subject, f"<pre>{email.body}</pre>", email.body)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send email")
    return {"success": True, "recipients": email.to}


# ── Summary (designed for AI Agents) ─────────────────────────────

@router.get(
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

    now = datetime.now(timezone.utc)

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
        overdue = 0
        active_tasks = []
        assignees_set = set()
        next_due = None

        for t in tasks:
            if t.status == "done":
                done += 1
            elif t.status == "in_progress":
                in_progress += 1
            elif t.status == "failed":
                failed += 1

            is_overdue = (
                t.due_date and t.due_date < now
                and t.status not in ("done", "failed")
            )
            if is_overdue:
                overdue += 1

            if t.status == "in_progress" or is_overdue:
                active_tasks.append({
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "priority": t.priority,
                    "assignee": t.assignee,
                    "due_date": t.due_date.isoformat() if t.due_date else None,
                })

            if t.assignee:
                assignees_set.add(t.assignee)

            if (
                t.due_date and t.due_date >= now
                and t.status not in ("done", "failed")
                and (next_due is None or t.due_date < next_due)
            ):
                next_due = t.due_date

        total_tasks_all += total
        total_done_all += done
        total_overdue += overdue

        project_summaries.append({
            "id": p.id,
            "name": p.name,
            "status": p.status,
            "progress": f"{round(done / total * 100, 1)}%" if total > 0 else "0%",
            "total_tasks": total,
            "done": done,
            "in_progress": in_progress,
            "failed": failed,
            "overdue": overdue,
            "next_due": next_due.isoformat() if next_due else None,
            "assignees": list(assignees_set),
            "active_tasks": active_tasks,
        })

    # Recent activity
    activity_query = db.query(ActivityLog).order_by(ActivityLog.created_at.desc())
    if api_key.project_id:
        activity_query = activity_query.filter(ActivityLog.project_id == api_key.project_id)
    recent = activity_query.limit(20).all()

    def _time_ago(dt):
        if not dt:
            return ""
        delta = now - dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else now - dt
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
            identity_summaries.append({
                "id": ident.id,
                "name": ident.name,
                "color": ident.color,
                "avatar": ident.avatar,
                "total_tasks": 0, "done": 0, "in_progress": 0, "overdue": 0,
                "projects": [],
            })
            continue
        identity_summaries.append({
            "id": ident.id,
            "name": ident.name,
            "color": ident.color,
            "avatar": ident.avatar,
            "total_tasks": sum(p["total_tasks"] for p in ident_projects),
            "done": sum(p["done"] for p in ident_projects),
            "in_progress": sum(p["in_progress"] for p in ident_projects),
            "overdue": sum(p["overdue"] for p in ident_projects),
            "projects": [{"id": p["id"], "name": p["name"], "progress": p["progress"]} for p in ident_projects],
        })

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


# ── Activity log via API ─────────────────────────────────────────

@router.get(
    "/activity",
    summary="Get activity log",
    description="""Returns recent activity log entries. Useful for AI agents to understand what changed recently.

Activities are recorded for: task creation, status changes, assignee changes, deletions, webhook callbacks, and project mutations. Requires `read` scope.""",
    response_model=list[ActivityEntryOut],
    responses=_auth_errors,
)
def api_activity(
    project_id: str | None = Query(None, description="Filter by project ID (optional)"),
    limit: int = Query(50, description="Max entries to return (1-200)", ge=1, le=200),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    query = db.query(ActivityLog)
    if api_key.project_id:
        query = query.filter(ActivityLog.project_id == api_key.project_id)
    elif project_id:
        query = query.filter(ActivityLog.project_id == project_id)
    entries = query.order_by(ActivityLog.created_at.desc()).limit(min(limit, 200)).all()
    return [
        {
            "id": a.id,
            "project_id": a.project_id,
            "task_id": a.task_id,
            "action": a.action,
            "actor": a.actor,
            "detail": a.detail,
            "meta": a.meta,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in entries
    ]


# ── Search ────────────────────────────────────────────────────────

@router.get(
    "/search",
    summary="Search tasks and projects",
    description="""Full-text search across task titles/descriptions and project names/descriptions.

Useful for AI agents to locate relevant tasks without paginating all projects. Returns enriched tasks (with labels, subtask counts, dependency IDs) and matching projects.

If the API key is scoped to a single project, search is automatically restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_search(
    q: str = Query(..., min_length=1, description="Search query (case-insensitive substring match)"),
    project_id: str | None = Query(None, description="Restrict search to a specific project"),
    limit: int = Query(50, ge=1, le=200, description="Max number of tasks to return"),
    offset: int = Query(0, ge=0, description="Offset for task pagination"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")

    # Project-scoped keys override the project_id filter
    if api_key.project_id:
        project_id = api_key.project_id

    pattern = f"%{q}%"

    task_query = db.query(Task).filter(
        (Task.title.ilike(pattern)) | (Task.description.ilike(pattern))
    )
    if project_id:
        task_query = task_query.filter(Task.project_id == project_id)
    tasks = task_query.order_by(Task.updated_at.desc()).offset(offset).limit(limit).all()

    projects = []
    if not project_id:
        proj_query = db.query(Project).filter(
            (Project.name.ilike(pattern)) | (Project.description.ilike(pattern))
        )
        for p in proj_query.limit(20).all():
            total = len(p.tasks)
            done = sum(1 for t in p.tasks if t.status == "done")
            projects.append({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "status": p.status,
                "total_tasks": total,
                "done_tasks": done,
                "progress": round(done / total * 100, 1) if total > 0 else 0.0,
                "created_at": p.created_at.isoformat(),
                "updated_at": p.updated_at.isoformat(),
            })

    return {
        "query": q,
        "tasks": [_enrich_task_for_search(t) for t in tasks],
        "projects": projects,
    }


# ── Comments ──────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/tasks/{task_id}/comments",
    summary="List comments on a task",
    description="Returns all comments on a task in chronological order. Agent-posted comments are attributed via the `author` field. Requires `read` scope.",
    response_model=list[CommentOut],
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_list_comments(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    return (
        db.query(Comment)
        .filter(Comment.task_id == task_id)
        .order_by(Comment.created_at.asc())
        .all()
    )


@router.post(
    "/projects/{project_id}/tasks/{task_id}/comments",
    status_code=status.HTTP_201_CREATED,
    summary="Add a comment to a task",
    description="""Posts a comment on a task. If `author` is omitted, it defaults to the API key name (e.g. `api:my-agent`), making agent comments easily identifiable.

Useful for agent-to-human and agent-to-agent communication within a task thread. Requires `write` scope.""",
    response_model=CommentOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
async def api_create_comment(
    project_id: str,
    task_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)

    data = body.model_dump()
    if not data.get("author"):
        data["author"] = f"api:{api_key.name}"

    comment = Comment(task_id=task_id, project_id=project_id, **data)
    db.add(comment)
    db.flush()
    log_activity(
        db, "comment.created",
        project_id=project_id, task_id=task_id,
        actor=f"api:{api_key.name}",
        detail=f"Comment added via API by {data['author']}",
        meta={"api_key": api_key.name},
    )
    db.commit()
    db.refresh(comment)
    await ws_manager.broadcast("comment.created", {"project_id": project_id, "task_id": task_id})
    return comment


@router.patch(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}",
    summary="Edit a comment",
    description="Updates the body of an existing comment. Requires `write` scope.",
    response_model=CommentOut,
    responses={**_auth_errors, 404: {"description": "Comment not found"}},
)
def api_update_comment(
    project_id: str,
    task_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.body = body.body
    db.commit()
    db.refresh(comment)
    return comment


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a comment",
    description="Permanently deletes a comment. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Comment not found"}},
)
def api_delete_comment(
    project_id: str,
    task_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()


# ── Labels ────────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/labels",
    summary="List labels in a project",
    description="Returns all labels defined in a project. Requires `read` scope.",
    response_model=list[LabelOut],
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_list_labels(
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return db.query(Label).filter(Label.project_id == project_id).order_by(Label.created_at.asc()).all()


@router.post(
    "/projects/{project_id}/labels",
    status_code=status.HTTP_201_CREATED,
    summary="Create a label",
    description="Creates a new label in a project. Labels can then be assigned to tasks. Requires `write` scope.",
    response_model=LabelOut,
    responses={**_auth_errors, 404: {"description": "Project not found"}},
)
def api_create_label(
    project_id: str,
    body: LabelCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    label = Label(project_id=project_id, **body.model_dump())
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.delete(
    "/projects/{project_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a label",
    description="Permanently deletes a label and removes it from all tasks in the project. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Label not found"}},
)
def api_delete_label(
    project_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    label = db.query(Label).filter(Label.id == label_id, Label.project_id == project_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    db.delete(label)
    db.commit()


@router.post(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_201_CREATED,
    summary="Assign a label to a task",
    description="Assigns an existing project label to a task. Idempotent — safe to call even if already assigned. Requires `write` scope.",
    response_model=LabelOut,
    responses={**_auth_errors, 404: {"description": "Task or label not found"}},
)
async def api_add_label_to_task(
    project_id: str,
    task_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)
    label = db.query(Label).filter(Label.id == label_id, Label.project_id == project_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    existing = db.query(TaskLabel).filter(TaskLabel.task_id == task_id, TaskLabel.label_id == label_id).first()
    if not existing:
        db.add(TaskLabel(task_id=task_id, label_id=label_id))
        log_activity(
            db, "task.label_added",
            project_id=project_id, task_id=task_id,
            actor=f"api:{api_key.name}",
            detail=f'Label "{label.name}" added to task "{task.title}" via API',
            meta={"label_id": label_id, "label_name": label.name, "api_key": api_key.name},
        )
        db.commit()
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task_id})
    return label


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a label from a task",
    description="Removes a label assignment from a task. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Label not assigned to task"}},
)
def api_remove_label_from_task(
    project_id: str,
    task_id: str,
    label_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    tl = db.query(TaskLabel).filter(TaskLabel.task_id == task_id, TaskLabel.label_id == label_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail="Label not assigned to task")
    db.delete(tl)
    db.commit()


# ── Task dependencies ─────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/tasks/{task_id}/dependencies",
    summary="Get task dependencies",
    description="""Returns the dependency graph for a task: which tasks block it (`blocked_by`) and which tasks it blocks (`blocking`).

Each entry includes `task_id`, `title`, and `status`, so agents can determine whether blockers are resolved without additional API calls. Requires `read` scope.""",
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_get_dependencies(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)

    blocked_by = []
    for dep in task.blocked_by_deps:
        blocker = db.query(Task).filter(Task.id == dep.depends_on_id).first()
        if blocker:
            blocked_by.append({"task_id": blocker.id, "title": blocker.title, "status": blocker.status})

    blocking = []
    for dep in task.blocking_deps:
        dependent = db.query(Task).filter(Task.id == dep.task_id).first()
        if dependent:
            blocking.append({"task_id": dependent.id, "title": dependent.title, "status": dependent.status})

    return {"task_id": task_id, "blocked_by": blocked_by, "blocking": blocking}


@router.post(
    "/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}",
    status_code=status.HTTP_201_CREATED,
    summary="Add a blocker dependency",
    description="Marks `task_id` as blocked by `depends_on_id` — the blocker task must complete before this task can proceed. Idempotent. Requires `write` scope.",
    responses={**_auth_errors, 400: {"description": "Self-dependency not allowed"}, 404: {"description": "Task not found"}},
)
def api_add_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    blocker = db.query(Task).filter(Task.id == depends_on_id, Task.project_id == project_id).first()
    if not blocker:
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if task_id == depends_on_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    existing = db.query(TaskDependency).filter(
        TaskDependency.task_id == task_id,
        TaskDependency.depends_on_id == depends_on_id,
    ).first()
    if existing:
        return {"task_id": task_id, "depends_on_id": depends_on_id}
    db.add(TaskDependency(task_id=task_id, depends_on_id=depends_on_id))
    db.commit()
    return {"task_id": task_id, "depends_on_id": depends_on_id}


@router.delete(
    "/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a blocker dependency",
    description="Removes the blocked-by relationship between two tasks. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Dependency not found"}},
)
def api_remove_dependency(
    project_id: str,
    task_id: str,
    depends_on_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    dep = db.query(TaskDependency).filter(
        TaskDependency.task_id == task_id,
        TaskDependency.depends_on_id == depends_on_id,
    ).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()


# ── Analytics ─────────────────────────────────────────────────────

@router.get(
    "/analytics/overview",
    summary="Platform analytics overview",
    description="""Platform-wide aggregated statistics: task counts by status, overdue count, most active project last 7 days.

If the API key is scoped to a single project, counts are restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_overview(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    pid = api_key.project_id  # None means platform-wide

    def _task_count(*filters):
        q = db.query(func.count(Task.id))
        if pid:
            q = q.filter(Task.project_id == pid)
        return (q.filter(*filters).scalar() or 0) if filters else (q.scalar() or 0)

    total_tasks = _task_count()
    done_tasks = _task_count(Task.status == "done")
    in_progress = _task_count(Task.status == "in_progress")
    overdue = _task_count(Task.due_date < now, Task.status.notin_(["done", "failed"]))

    proj_q = db.query(func.count(Project.id))
    if pid:
        proj_q = proj_q.filter(Project.id == pid)
    total_projects = proj_q.scalar() or 0
    active_projects = proj_q.filter(Project.status == "active").scalar() or 0

    act_q = (
        db.query(ActivityLog.project_id, func.count(ActivityLog.id).label("cnt"))
        .filter(ActivityLog.created_at >= week_ago, ActivityLog.project_id.isnot(None))
    )
    if pid:
        act_q = act_q.filter(ActivityLog.project_id == pid)
    top_activity = act_q.group_by(ActivityLog.project_id).order_by(func.count(ActivityLog.id).desc()).first()
    most_active_project = None
    if top_activity:
        p = db.query(Project).filter(Project.id == top_activity.project_id).first()
        if p:
            most_active_project = {"id": p.id, "name": p.name, "activity_count": top_activity.cnt}

    return {
        "total_projects": total_projects,
        "active_projects": active_projects,
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "in_progress_tasks": in_progress,
        "overdue_tasks": overdue,
        "most_active_project": most_active_project,
    }


@router.get(
    "/analytics/heatmap",
    summary="Activity heatmap data",
    description="""Daily activity counts for the last year (or a custom date range). Useful for visualizing work cadence.

Pass `start` and `end` as `YYYY-MM-DD`. Optionally filter by `project_id`. If the API key is project-scoped, data is restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_heatmap(
    start: str | None = Query(None, description="Start date YYYY-MM-DD (default: 1 year ago)"),
    end: str | None = Query(None, description="End date YYYY-MM-DD (default: today)"),
    project_id: str | None = Query(None, description="Filter by project"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    if api_key.project_id:
        project_id = api_key.project_id
    now = datetime.now(timezone.utc)
    end_dt = datetime.fromisoformat(end) if end else now
    start_dt = datetime.fromisoformat(start) if start else end_dt - timedelta(days=365)

    q = db.query(
        cast(ActivityLog.created_at, Date).label("day"),
        func.count(ActivityLog.id).label("count"),
    ).filter(ActivityLog.created_at >= start_dt, ActivityLog.created_at <= end_dt)
    if project_id:
        q = q.filter(ActivityLog.project_id == project_id)
    rows = q.group_by("day").order_by("day").all()
    return [{"date": str(r.day), "count": r.count} for r in rows]


@router.get(
    "/analytics/status-trend",
    summary="Task status trend over time",
    description="""Daily snapshot of task counts by status (todo, in_progress, done, failed) over the last N days.

Useful for agents tracking project momentum and detecting stalls. Optionally filter by `project_id`. If the API key is project-scoped, data is restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_status_trend(
    project_id: str | None = Query(None, description="Filter by project"),
    days: int = Query(30, ge=1, le=365, description="Number of days to include"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    if api_key.project_id:
        project_id = api_key.project_id
    now = datetime.now(timezone.utc)
    result = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=23, minute=59, second=59)
        q = db.query(Task.status, func.count(Task.id)).filter(Task.created_at <= day)
        if project_id:
            q = q.filter(Task.project_id == project_id)
        rows = q.group_by(Task.status).all()
        entry = {"date": day.strftime("%Y-%m-%d"), "todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        for s, count in rows:
            if s in entry:
                entry[s] = count
        result.append(entry)
    return result


@router.get(
    "/analytics/velocity",
    summary="Sprint velocity per completed cycle",
    description="""Returns completed tasks per cycle for a project, useful for measuring team/agent velocity across sprints.

Requires a `project_id` query parameter. Requires `read` scope.""",
    responses={**_auth_errors, 400: {"description": "project_id is required for non-scoped keys"}},
)
def api_analytics_velocity(
    project_id: str | None = Query(None, description="Project to analyze (required unless the key is project-scoped)"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    pid = api_key.project_id or project_id
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    _check_project_access(api_key, pid)
    cycles = db.query(Cycle).filter(
        Cycle.project_id == pid,
        Cycle.status == "completed",
    ).order_by(Cycle.start_date).all()
    result = []
    for cycle in cycles:
        task_ids = [ct.task_id for ct in cycle.cycle_tasks]
        done_count = sum(1 for ct in cycle.cycle_tasks if ct.task and ct.task.status == "done")
        result.append({
            "cycle_id": cycle.id,
            "name": cycle.name,
            "total_tasks": len(task_ids),
            "completed_tasks": done_count,
            "start_date": cycle.start_date.isoformat() if cycle.start_date else None,
            "end_date": cycle.end_date.isoformat() if cycle.end_date else None,
        })
    return result


# ── Notifications ─────────────────────────────────────────────────

@router.get(
    "/notifications",
    summary="List in-app notifications",
    description="Returns recent in-app notifications. Pass `unread_only=true` to retrieve only unread ones. Requires `read` scope.",
    response_model=list[NotificationOut],
    responses=_auth_errors,
)
def api_list_notifications(
    unread_only: bool = Query(False, description="Return only unread notifications"),
    limit: int = Query(50, ge=1, le=200, description="Max notifications to return"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    q = db.query(Notification)
    if unread_only:
        q = q.filter(Notification.read == False)  # noqa: E712
    return q.order_by(Notification.created_at.desc()).limit(limit).all()


@router.get(
    "/notifications/unread-count",
    summary="Get unread notification count",
    description="Returns the number of unread in-app notifications. Useful for agents to poll for new events. Requires `read` scope.",
    responses=_auth_errors,
)
def api_notifications_unread_count(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    count = db.query(Notification).filter(Notification.read == False).count()  # noqa: E712
    return {"count": count}


@router.patch(
    "/notifications/{notification_id}/read",
    summary="Mark a notification as read",
    description="Marks a single notification as read. Requires `write` scope.",
    response_model=NotificationOut,
    responses={**_auth_errors, 404: {"description": "Notification not found"}},
)
def api_mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    db.commit()
    db.refresh(notif)
    return notif
