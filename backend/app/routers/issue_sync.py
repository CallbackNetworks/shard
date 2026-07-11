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
from app.models import Comment, Integration, Label, Notification, Project, Task, TaskLabel, TaskPullRequest
from app.services.activity import log_activity
from app.services.issue_sync import (
    GITHUB_API_BASE,
    close_github_issue,
    close_gitlab_issue,
    create_github_issue,
    create_github_issue_comment,
    create_gitlab_issue,
    create_gitlab_issue_note,
    delete_github_issue_comment,
    delete_gitlab_issue_note,
    detect_comment_webhook,
    detect_issue_webhook,
    detect_pr_review_webhook,
    detect_pr_webhook,
    format_due_date_gitea,
    format_due_date_gitlab,
    lookup_gitlab_user_id,
    parse_repo_url,
    reopen_github_issue,
    reopen_gitlab_issue,
    replace_github_issue_labels,
    replace_gitlab_issue_labels,
    resolve_github_api_base,
    update_github_issue_comment,
    update_github_issue_fields,
    update_gitlab_issue_fields,
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
        review_data = detect_pr_review_webhook(headers, body)
        if review_data:
            return await _handle_pr_review_event(review_data, project_id, db)
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
        if "due_date" in normalized:
            existing.due_date = normalized["due_date"]
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
        due_date=normalized.get("due_date"),
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


def _find_pr_tasks(pr_data: dict, project_id: str, db: Session) -> list[Task]:
    """Tasks referenced via 'Fixes #N' in the PR body, plus tasks already linked to this PR."""
    repo = pr_data["repo"]
    pr_number = str(pr_data["pr_number"])
    tasks: dict[str, Task] = {}

    for ref_num in pr_data.get("issue_refs", []):
        task = _find_external_task(project_id, "github", ref_num, repo, db)
        if task:
            tasks[task.id] = task

    links = (
        db.query(TaskPullRequest)
        .join(Task, Task.id == TaskPullRequest.task_id)
        .filter(
            Task.project_id == project_id,
            TaskPullRequest.repo == repo,
            TaskPullRequest.pr_number == pr_number,
        )
        .all()
    )
    for link in links:
        if link.task is not None:
            tasks[link.task_id] = link.task

    return list(tasks.values())


def _upsert_pr_link(db: Session, task: Task, pr_data: dict, state: str | None) -> TaskPullRequest:
    """Create or refresh the structured PR link on a task. state=None keeps the current state."""
    pr_number = str(pr_data["pr_number"])
    link = (
        db.query(TaskPullRequest)
        .filter(
            TaskPullRequest.task_id == task.id,
            TaskPullRequest.repo == pr_data["repo"],
            TaskPullRequest.pr_number == pr_number,
        )
        .first()
    )
    if not link:
        link = TaskPullRequest(
            task_id=task.id,
            provider="github",
            repo=pr_data["repo"],
            pr_number=pr_number,
            pr_url=pr_data.get("pr_url", ""),
            pr_title=pr_data.get("pr_title", ""),
            branch=pr_data.get("branch"),
            state=state or "open",
        )
        db.add(link)
        db.flush()
        return link

    if pr_data.get("pr_url"):
        link.pr_url = pr_data["pr_url"]
    if pr_data.get("pr_title"):
        link.pr_title = pr_data["pr_title"]
    if pr_data.get("branch"):
        link.branch = pr_data["branch"]
    if state is not None:
        link.state = state
    return link


async def _notify_pr(db: Session, ntype: str, message: str, url: str, project_id: str, task_id: str) -> None:
    """Create an in-app notification whose link jumps straight to the external PR page."""
    notif = Notification(type=ntype, message=message, link=url, project_id=project_id, task_id=task_id)
    db.add(notif)
    db.commit()
    await ws_manager.broadcast("notification.new", {"id": notif.id})


async def _handle_pr_event(pr_data: dict, project_id: str, db: Session) -> dict:
    """Handle a GitHub pull_request webhook event — lifecycle signals only.

    PR content (diff, review threads) is never mirrored; the stored pr_url is
    the jump-off point (ADR-0017).

    - opened/reopened: upsert the PR link, move todo tasks to in_progress
    - review_requested: flag the PR link and raise an in-app notification
    - closed merged: mark the link merged and complete referenced tasks
    - closed unmerged: mark the link closed and raise an in-app notification
    """
    action = pr_data.get("action", "")
    pr_url = pr_data["pr_url"]
    pr_number = pr_data["pr_number"]
    merged = pr_data.get("merged", False)

    tasks = _find_pr_tasks(pr_data, project_id, db)
    affected_task_ids: list[str] = []

    if action in ("opened", "edited", "synchronize", "reopened", "ready_for_review"):
        for task in tasks:
            _upsert_pr_link(db, task, pr_data, "open")
            if action in ("opened", "reopened") and task.status == "todo":
                task.status = "in_progress"
                log_activity(
                    db,
                    "task.status_changed",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'Task "{task.title}" moved to in_progress by PR #{pr_number}',
                    meta={"pr_url": pr_url, "old_status": "todo", "new_status": "in_progress"},
                )
            else:
                log_activity(
                    db,
                    "task.pr_linked",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'PR #{pr_number} linked to task "{task.title}"',
                    meta={"pr_url": pr_url},
                )
            affected_task_ids.append(task.id)

        db.commit()
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})
        return {"ok": True, "action": "pr_linked", "affected_tasks": affected_task_ids}

    if action == "review_requested":
        for task in tasks:
            link = _upsert_pr_link(db, task, pr_data, "open")
            link.review_state = "review_requested"
            affected_task_ids.append(task.id)
        db.commit()
        if tasks:
            await _notify_pr(
                db,
                "pr.review_requested",
                f'PR #{pr_number} "{pr_data["pr_title"]}" is awaiting review',
                pr_url,
                project_id,
                tasks[0].id,
            )
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})
        return {"ok": True, "action": "pr_review_requested", "affected_tasks": affected_task_ids}

    if action == "closed" and merged:
        for task in tasks:
            _upsert_pr_link(db, task, pr_data, "merged")
            if task.status != "done":
                task.status = "done"
                log_activity(
                    db,
                    "task.completed",
                    project_id=project_id,
                    task_id=task.id,
                    actor="pr-sync:github",
                    detail=f'Task "{task.title}" completed by merged PR #{pr_number}',
                    meta={"pr_url": pr_url},
                )
            affected_task_ids.append(task.id)

        # Legacy fallback: tasks whose description contains this PR URL
        # (from the pre-ADR-0016 description-append linking)
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
                    detail=f'Task "{task.title}" completed by merged PR #{pr_number}',
                    meta={"pr_url": pr_url},
                )
                affected_task_ids.append(task.id)

        db.commit()
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})
        return {"ok": True, "action": "pr_merged", "affected_tasks": affected_task_ids}

    if action == "closed" and not merged:
        for task in tasks:
            _upsert_pr_link(db, task, pr_data, "closed")
            log_activity(
                db,
                "task.pr_closed",
                project_id=project_id,
                task_id=task.id,
                actor="pr-sync:github",
                detail=f'PR #{pr_number} on task "{task.title}" was closed without merging',
                meta={"pr_url": pr_url},
            )
            affected_task_ids.append(task.id)
        db.commit()
        if tasks:
            await _notify_pr(
                db,
                "pr.closed",
                f'PR #{pr_number} "{pr_data["pr_title"]}" was closed without merging',
                pr_url,
                project_id,
                tasks[0].id,
            )
        for tid in affected_task_ids:
            await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})
        return {"ok": True, "action": "pr_closed", "affected_tasks": affected_task_ids}

    return {"ok": True, "action": "pr_ignored", "affected_tasks": []}


async def _handle_pr_review_event(data: dict, project_id: str, db: Session) -> dict:
    """Handle a GitHub pull_request_review webhook event (review signals only)."""
    if data.get("action") != "submitted":
        return {"ok": True, "action": "pr_review_ignored", "affected_tasks": []}

    review_state = data.get("review_state") or "commented"
    tasks = _find_pr_tasks(data, project_id, db)
    affected_task_ids: list[str] = []

    for task in tasks:
        link = _upsert_pr_link(db, task, data, None)
        link.review_state = review_state
        log_activity(
            db,
            "task.pr_reviewed",
            project_id=project_id,
            task_id=task.id,
            actor=data.get("reviewer") or "pr-sync:github",
            detail=f'PR #{data["pr_number"]} on task "{task.title}" reviewed: {review_state}',
            meta={"pr_url": data.get("pr_url", ""), "review_state": review_state},
        )
        affected_task_ids.append(task.id)

    db.commit()
    if tasks and review_state in ("approved", "changes_requested"):
        verb = "approved" if review_state == "approved" else "needs changes"
        await _notify_pr(
            db,
            f"pr.{review_state}",
            f'PR #{data["pr_number"]} "{data.get("pr_title", "")}" {verb}',
            data.get("pr_url", ""),
            project_id,
            tasks[0].id,
        )
    for tid in affected_task_ids:
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": tid})
    return {"ok": True, "action": f"pr_review_{review_state}", "affected_tasks": affected_task_ids}


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


async def sync_task_fields_to_external(task: Task, db: Session, changed: set[str]) -> bool:
    """
    Push changed task fields (title, description, assignee, due_date) to the linked issue.

    Last-write-wins in both directions: inbound issue events overwrite the task,
    outbound edits overwrite the issue. Due dates only apply to Gitea and GitLab —
    github.com / GitHub Enterprise issues have no due date, so it is never sent there.
    """
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target

    if task.external_provider == "github":
        payload: dict = {}
        if "title" in changed:
            payload["title"] = task.title
        if "description" in changed:
            payload["body"] = task.description or ""
        if "assignee" in changed:
            payload["assignees"] = [task.assignee] if task.assignee else []
        ok = True
        if payload:
            ok = await update_github_issue_fields(task.external_repo, task.external_id, payload, token, base)
        # Gitea (any github-compatible host other than github.com/GHE's api.github.com)
        # supports due_date. Send it as its own request so a non-Gitea host that
        # rejects the field cannot fail the title/description update.
        if "due_date" in changed and base.rstrip("/") != GITHUB_API_BASE:
            due = format_due_date_gitea(task.due_date)
            await update_github_issue_fields(task.external_repo, task.external_id, {"due_date": due}, token, base)
        return ok

    payload = {}
    if "title" in changed:
        payload["title"] = task.title
    if "description" in changed:
        payload["description"] = task.description or ""
    if "assignee" in changed:
        if task.assignee:
            user_id = await lookup_gitlab_user_id(task.assignee, token, base)
            if user_id is not None:
                payload["assignee_ids"] = [user_id]
        else:
            payload["assignee_ids"] = []
    if "due_date" in changed:
        payload["due_date"] = format_due_date_gitlab(task.due_date)
    if not payload:
        return False
    return await update_gitlab_issue_fields(task.external_repo, task.external_id, payload, token, base)


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


async def create_external_issue_from_task(task: Task, project: Project, db: Session, provider: str | None = None):
    """Create a new external issue from a Shard-origin task and link it back.

    Explicit user action (last-write-wins does not apply — the task is the source
    of truth here). Requires an active issue_sync integration with a token and a
    project repo URL. On success, sets the task's external_* fields so all later
    two-way sync (state, fields, comments, labels) flows through the usual paths.
    Raises HTTPException with an actionable message on any precondition failure.
    """
    if task.external_id:
        raise HTTPException(status_code=409, detail="Task is already linked to an external issue")

    integration = _get_sync_integration(task.project_id, db)
    if not integration or not integration.secret:
        raise HTTPException(
            status_code=400,
            detail="No active issue_sync integration with a token is configured for this project",
        )

    parsed = parse_repo_url(project.repo_url or "", provider)
    if not parsed:
        raise HTTPException(
            status_code=400,
            detail="Project has no valid repo URL; set the project's repo URL first",
        )

    token = integration.secret
    labels = [tl.label.name for tl in task.task_labels if tl.label.type == "label"]

    if parsed["provider"] == "github":
        result = await create_github_issue(
            parsed["repo"], task.title, task.description or "", labels, task.assignee, token, parsed["base"]
        )
    else:
        result = await create_gitlab_issue(
            parsed["repo"], task.title, task.description or "", labels, token, parsed["base"]
        )

    if not result:
        raise HTTPException(status_code=502, detail="External issue creation failed; check the token and repo URL")

    task.external_provider = parsed["provider"]
    task.external_id = result["number"]
    task.external_url = result["url"]
    task.external_repo = parsed["repo"]

    log_activity(
        db,
        "task.issue_created",
        project_id=task.project_id,
        task_id=task.id,
        actor=f"issue-sync:{parsed['provider']}",
        detail=f'Created {parsed["provider"]} issue #{result["number"]} from task "{task.title}"',
        meta={"external_url": result["url"], "external_repo": parsed["repo"]},
    )
    db.commit()
    db.refresh(task)
    await ws_manager.broadcast("task.updated", {"project_id": task.project_id, "task_id": task.id})
    return task
