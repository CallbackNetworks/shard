"""
Inbound GitHub / GitLab issue webhook endpoint.

Receives issue, issue-comment, and pull-request events and mirrors them onto
Shard tasks, comments, and labels. Also hosts the outbound sync helpers that
push Shard-side changes (state, comments, labels) back to the external issue.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Comment, Integration, Label, Project, Task, TaskLabel
from app.services.activity import log_activity
from app.services.issue_sync import (
    close_github_issue,
    close_gitlab_issue,
    create_github_issue_comment,
    create_gitlab_issue_note,
    delete_github_issue_comment,
    delete_gitlab_issue_note,
    detect_comment_webhook,
    detect_issue_webhook,
    detect_pr_webhook,
    reopen_github_issue,
    reopen_gitlab_issue,
    replace_github_issue_labels,
    replace_gitlab_issue_labels,
    resolve_github_api_base,
    update_github_issue_comment,
    update_gitlab_issue_note,
)
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/issues", tags=["issue-sync"])

STATUS_MAP = {
    "todo": "todo",
    "in_progress": "in_progress",
    "done": "done",
}


def _get_sync_integration(project_id: str, db: Session) -> Integration | None:
    """Return the active issue_sync integration for a project, if any."""
    return (
        db.query(Integration)
        .filter(
            Integration.type == "issue_sync",
            Integration.project_id == project_id,
            Integration.active.is_(True),
        )
        .first()
    )


def _find_external_task(project_id: str, provider: str, external_id: str, repo: str, db: Session) -> Task | None:
    return (
        db.query(Task)
        .filter(
            Task.project_id == project_id,
            Task.external_provider == provider,
            Task.external_id == external_id,
            Task.external_repo == repo,
        )
        .first()
    )


def _apply_external_labels(task: Task, label_names: list[str], db: Session) -> None:
    """Mirror the external issue's label set onto the task.

    Only plain labels (type == "label") are touched; decision labels and other
    enhanced label types (ADR-0004) are never attached or detached here.
    Missing labels are created project-scoped with source "issue_sync".
    """
    wanted = set(label_names)
    current = {tl.label.name: tl for tl in task.task_labels if tl.label.type == "label"}

    for name in wanted - set(current):
        label = (
            db.query(Label)
            .filter(Label.project_id == task.project_id, Label.name == name, Label.type == "label")
            .first()
        )
        if not label:
            label = Label(project_id=task.project_id, name=name, source="issue_sync")
            db.add(label)
            db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=label.id))

    for name, tl in current.items():
        if name not in wanted:
            db.delete(tl)


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
        comment_data = detect_comment_webhook(headers, body)
        if comment_data:
            return await _handle_comment_event(comment_data, project_id, db)
        pr_data = detect_pr_webhook(headers, body)
        if pr_data:
            return await _handle_pr_event(pr_data, project_id, db)
        return {"ok": True, "detail": "Ignored (not an issue event)"}

    provider = normalized["provider"]
    ext_id = normalized["external_id"]
    repo = normalized["repo"]

    existing = _find_external_task(project_id, provider, ext_id, repo, db)

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
        _apply_external_labels(existing, normalized.get("labels", []), db)

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
    _apply_external_labels(task, normalized.get("labels", []), db)

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


async def _handle_comment_event(data: dict, project_id: str, db: Session) -> dict:
    """Mirror an external issue-comment event (created/edited/deleted) onto Shard comments.

    Comments that originated from Shard (matched by external_id) are not
    re-created when their webhook echo arrives.
    """
    task = _find_external_task(project_id, data["provider"], data["issue_id"], data["repo"], db)
    if not task:
        return {"ok": True, "detail": "Ignored (no linked task)"}

    action = data.get("action", "created")
    ext_comment_id = data["comment_id"]
    existing = db.query(Comment).filter(Comment.task_id == task.id, Comment.external_id == ext_comment_id).first()

    if action == "deleted":
        if not existing:
            return {"ok": True, "action": "comment_ignored"}
        db.delete(existing)
        log_activity(
            db,
            "task.comment_deleted",
            project_id=project_id,
            task_id=task.id,
            actor=f"issue-sync:{data['provider']}",
            detail=f'Comment deleted on "{task.title}" via {data["provider"]} issue sync',
        )
        db.commit()
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task.id})
        return {"ok": True, "action": "comment_deleted"}

    if existing:
        if action == "created":
            # Echo of a comment Shard itself pushed outbound
            return {"ok": True, "action": "comment_echo_ignored"}
        existing.body = data["body"]
        if data.get("author"):
            existing.author = data["author"]
        db.commit()
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task.id})
        return {"ok": True, "action": "comment_updated", "comment_id": existing.id}

    comment = Comment(
        task_id=task.id,
        project_id=project_id,
        author=data.get("author"),
        body=data["body"],
        external_id=ext_comment_id,
    )
    db.add(comment)
    db.flush()
    log_activity(
        db,
        "task.commented",
        project_id=project_id,
        task_id=task.id,
        actor=data.get("author") or f"issue-sync:{data['provider']}",
        detail=f'Comment added to "{task.title}" from {data["provider"]} issue #{data["issue_id"]}',
        meta={"external_url": data.get("url", "")},
    )
    db.commit()
    await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task.id})
    return {"ok": True, "action": "comment_created", "comment_id": comment.id}


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


def _external_sync_target(task: Task, db: Session) -> tuple[str, str] | None:
    """Return (token, api_base_or_gitlab_url) when the task is linked and sync is configured."""
    if not task.external_provider or not task.external_id or not task.external_repo:
        return None
    integration = _get_sync_integration(task.project_id, db)
    if not integration or not integration.secret:
        return None
    if task.external_provider == "github":
        return integration.secret, resolve_github_api_base(task.external_url, integration.url)
    if task.external_provider == "gitlab":
        return integration.secret, integration.url or "https://gitlab.com"
    return None


async def sync_task_closure_to_external(task: Task, db: Session) -> bool:
    """
    When a Shard task is marked done, close the corresponding external issue.
    Returns True if an external issue was closed.
    """
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        return await close_github_issue(task.external_repo, task.external_id, token, base)
    return await close_gitlab_issue(task.external_repo, task.external_id, token, base)


async def sync_task_reopen_to_external(task: Task, db: Session) -> bool:
    """
    When a done Shard task is moved back to an open status, reopen the external issue.
    Returns True if an external issue was reopened.
    """
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        return await reopen_github_issue(task.external_repo, task.external_id, token, base)
    return await reopen_gitlab_issue(task.external_repo, task.external_id, token, base)


async def sync_comment_to_external(comment: Comment, task: Task, db: Session) -> bool:
    """
    Push a Shard-created comment to the linked external issue and store the
    returned external comment id (used to skip the webhook echo).
    """
    if comment.external_id:
        return False  # originated externally, nothing to push
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        ext_id = await create_github_issue_comment(task.external_repo, task.external_id, comment.body, token, base)
    else:
        ext_id = await create_gitlab_issue_note(task.external_repo, task.external_id, comment.body, token, base)
    if not ext_id:
        return False
    comment.external_id = ext_id
    db.commit()
    return True


async def sync_comment_update_to_external(comment: Comment, task: Task, db: Session) -> bool:
    """Push an edited Shard comment body to the linked external comment."""
    if not comment.external_id:
        return False
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        return await update_github_issue_comment(task.external_repo, comment.external_id, comment.body, token, base)
    return await update_gitlab_issue_note(
        task.external_repo, task.external_id, comment.external_id, comment.body, token, base
    )


async def sync_comment_delete_to_external(external_comment_id: str, task: Task, db: Session) -> bool:
    """Delete the linked external comment after a Shard comment is deleted."""
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        return await delete_github_issue_comment(task.external_repo, external_comment_id, token, base)
    return await delete_gitlab_issue_note(task.external_repo, task.external_id, external_comment_id, token, base)


async def sync_labels_to_external(task: Task, db: Session) -> bool:
    """Replace the external issue's labels with the task's current plain-label set."""
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    names = [tl.label.name for tl in task.task_labels if tl.label.type == "label"]
    if task.external_provider == "github":
        return await replace_github_issue_labels(task.external_repo, task.external_id, names, token, base)
    return await replace_gitlab_issue_labels(task.external_repo, task.external_id, names, token, base)
