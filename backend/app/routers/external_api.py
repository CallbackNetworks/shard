"""
External API v1 — authenticated with API keys.

All endpoints require an `X-API-Key` header.
Scopes: read (GET), write (POST/PATCH/DELETE), admin (all).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Project, Task, Integration, ActivityLog, Identity
from app.schemas import (
    ProjectCreate, ProjectUpdate, ProjectOut,
    TaskCreate, TaskUpdate, TaskOut,
    WebhookCallback,
    ProjectStatsOut, EmailStatusOut, EmailSendRequest, EmailSendOut,
    SummaryOut, ActivityEntryOut,
)
from app.services.notifier import fire_notifications
from app.services.activity import log_activity

router = APIRouter(prefix="/api/v1", tags=["External API v1"])


# ── Auth dependency ───────────────────────────────────────────────

def _get_api_key(
    x_api_key: str = Header(..., alias="X-API-Key", description="API key (starts with tdp_). Create one in the API Keys page."),
    db: Session = Depends(get_db),
) -> ApiKey:
    api_key = db.query(ApiKey).filter(ApiKey.key == x_api_key, ApiKey.active == True).first()
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
