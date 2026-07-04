"""
Inbound GitHub / GitLab issue webhook endpoint.

Receives issue events and creates or updates Shard tasks accordingly.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Integration, Project, Task
from app.services.activity import log_activity
from app.services.issue_sync import close_github_issue, close_gitlab_issue, detect_issue_webhook, detect_pr_webhook
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/issues", tags=["issue-sync"])

STATUS_MAP = {
    "todo": "todo",
    "in_progress": "in_progress",
    "done": "done",
}


@router.post("/{project_id}")
async def receive_issue_webhook(
    project_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Receive GitHub or GitLab issue webhook events.

    Auto-detects the provider from request headers. Creates a new task if the
    external issue doesn't exist yet, or updates the existing task's status.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    body = await request.json()
    headers = dict(request.headers)
    normalized = detect_issue_webhook(headers, body)
    if not normalized:
        pr_data = detect_pr_webhook(headers, body)
        if pr_data:
            return await _handle_pr_event(pr_data, project_id, db)
        return {"ok": True, "detail": "Ignored (not an issue event)"}

    provider = normalized["provider"]
    ext_id = normalized["external_id"]
    repo = normalized["repo"]

    existing = (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.external_provider == provider,
            Task.external_id == ext_id,
            Task.external_repo == repo,
        )
        .first()
    )

    action = normalized.get("action", "")

    if action == "deleted":
        if existing:
            db.delete(existing)
            log_activity(
                db,
                "task.deleted",
                project_id=project_id,
                task_id=existing.id,
                actor=f"issue-sync:{provider}",
                detail=f'Task "{existing.title}" deleted via {provider} issue sync',
            )
            db.commit()
            await ws_manager.broadcast("task.deleted", {"project_id": project_id, "task_id": existing.id})
        return {"ok": True, "action": "deleted"}

    if existing:
        old_status = existing.status
        new_status = STATUS_MAP.get(normalized["status"], "todo")
        existing.title = normalized["title"]
        existing.description = normalized["description"]
        existing.external_url = normalized["external_url"]
        if new_status != old_status:
            existing.status = new_status
        if normalized.get("assignee"):
            existing.assignee = normalized["assignee"]

        log_activity(
            db,
            "task.updated",
            project_id=project_id,
            task_id=existing.id,
            actor=f"issue-sync:{provider}",
            detail=f'Task "{existing.title}" updated via {provider} issue #{ext_id}',
            meta={"external_url": normalized["external_url"]},
        )
        db.commit()
        db.refresh(existing)
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": existing.id})
        return {"ok": True, "action": "updated", "task_id": existing.id}

    task = Task(
        project_id=project_id,
        title=normalized["title"],
        description=normalized["description"],
        status=STATUS_MAP.get(normalized["status"], "todo"),
        assignee=normalized.get("assignee"),
        external_provider=provider,
        external_id=ext_id,
        external_url=normalized["external_url"],
        external_repo=repo,
    )
    db.add(task)
    db.flush()

    log_activity(
        db,
        "task.created",
        project_id=project_id,
        task_id=task.id,
        actor=f"issue-sync:{provider}",
        detail=f'Task "{task.title}" created from {provider} issue #{ext_id}',
        meta={"external_url": normalized["external_url"]},
    )
    db.commit()
    db.refresh(task)
    await ws_manager.broadcast("task.created", {"project_id": project_id, "task_id": task.id})
    return {"ok": True, "action": "created", "task_id": task.id}


async def _handle_pr_event(pr_data: dict, project_id: str, db: Session) -> dict:
    """Handle a GitHub pull_request webhook event.

    - On opened/edited: link the PR URL to tasks referenced via 'Fixes #N' etc.
    - On merged (action=closed, merged=true): mark referenced tasks as done.
    """
    action = pr_data.get("action", "")
    repo = pr_data["repo"]
    pr_url = pr_data["pr_url"]
    pr_title = pr_data["pr_title"]
    issue_refs = pr_data.get("issue_refs", [])
    merged = pr_data.get("merged", False)

    affected_task_ids: list[str] = []

    # Find tasks matching the issue references
    referenced_tasks = []
    for ref_num in issue_refs:
        task = (
            db.query(Task)
            .filter(
                Task.project_id == project_id,
                Task.external_provider == "github",
                Task.external_id == ref_num,
                Task.external_repo == repo,
            )
            .first()
        )
        if task:
            referenced_tasks.append(task)

    if action in ("opened", "edited", "synchronize", "reopened"):
        # Link PR URL to task descriptions
        for task in referenced_tasks:
            pr_link = f"\n\nLinked PR: [{pr_title}]({pr_url})"
            if pr_url not in (task.description or ""):
                task.description = (task.description or "") + pr_link
                log_activity(
                    db,
                    "task.updated",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'PR #{pr_data["pr_number"]} linked to task "{task.title}"',
                    meta={"pr_url": pr_url},
                )
                affected_task_ids.append(task.id)

        db.commit()
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})

        return {
            "ok": True,
            "action": "pr_linked",
            "affected_tasks": affected_task_ids,
        }

    if action == "closed" and merged:
        # Merged PR: mark referenced tasks as done
        for task in referenced_tasks:
            if task.status != "done":
                task.status = "done"
                log_activity(
                    db,
                    "task.completed",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'Task "{task.title}" completed by merged PR #{pr_data["pr_number"]}',
                    meta={"pr_url": pr_url},
                )
                affected_task_ids.append(task.id)

        # Also check for tasks whose description already contains this PR URL
        tasks_with_pr_url = (
            db.query(Task)
            .filter(
                Task.project_id == project_id,
                Task.description.contains(pr_url),
                Task.status != "done",
            )
            .all()
        )
        for task in tasks_with_pr_url:
            if task.id not in affected_task_ids:
                task.status = "done"
                log_activity(
                    db,
                    "task.completed",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'Task "{task.title}" completed by merged PR #{pr_data["pr_number"]}',
                    meta={"pr_url": pr_url},
                )
                affected_task_ids.append(task.id)

        db.commit()
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})

        return {
            "ok": True,
            "action": "pr_merged",
            "affected_tasks": affected_task_ids,
        }

    # Closed without merge or other actions: acknowledge but take no action
    return {"ok": True, "action": "pr_ignored", "affected_tasks": []}


async def sync_task_closure_to_external(task: Task, db: Session) -> bool:
    """
    When a Shard task is marked done, close the corresponding external issue.
    Returns True if an external issue was closed.
    """
    if not task.external_provider or not task.external_id or not task.external_repo:
        return False

    integration = (
        db.query(Integration)
        .filter(
            Integration.type == "issue_sync",
            Integration.project_id == task.project_id,
            Integration.active.is_(True),
        )
        .first()
    )
    if not integration or not integration.secret:
        return False

    token = integration.secret

    if task.external_provider == "github":
        return await close_github_issue(task.external_repo, task.external_id, token)
    elif task.external_provider == "gitlab":
        gitlab_url = integration.url or "https://gitlab.com"
        return await close_gitlab_issue(task.external_repo, task.external_id, token, gitlab_url)

    return False
