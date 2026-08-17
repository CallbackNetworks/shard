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
from app.models import (
    Comment,
    Integration,
    Node,
    Notification,
    TaskPullRequest,
)
from app.services import graph
from app.services.activity import log_activity
from app.services.enrichment import enrich_task
from app.services.errors import Invalid, ServiceError
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
    find_or_create_github_milestone,
    find_or_create_gitlab_milestone,
    format_due_date_gitea,
    format_due_date_gitlab,
    lookup_gitlab_user_id,
    parse_repo_url,
    reopen_github_issue,
    reopen_gitlab_issue,
    replace_github_issue_labels,
    replace_gitlab_issue_labels,
    resolve_github_api_base,
    set_github_issue_milestone,
    set_gitlab_issue_milestone,
    update_github_issue_comment,
    update_github_issue_fields,
    update_gitlab_issue_fields,
    update_gitlab_issue_note,
)
from app.services.task_mutations import apply_task_update, finalize_task_create
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


def _find_external_task(
    project_id: str, provider: str, external_id: str, repo: str, db: Session
) -> "graph.TaskView | None":
    # external_provider/id/repo live in node.data (JSON); scan the project's task
    # nodes and match in Python (ADR-0033, node-only tasks).
    for node in db.query(Node).filter(
        graph.task_type_filter(db), Node.id.in_(graph.contained_task_ids(db, project_id))
    ):
        data = node.data or {}
        if (
            data.get("external_provider") == provider
            and data.get("external_id") == external_id
            and data.get("external_repo") == repo
        ):
            return graph.task_view(node, db)
    return None


def _apply_external_labels(task: "graph.TaskView", label_names: list[str], db: Session) -> None:
    """Mirror the external issue's label set onto the task.

    Only plain labels (type == "label") are touched; decision labels and other
    enhanced label types (ADR-0004) are never attached or detached here.
    Missing labels are created project-scoped with source "issue_sync".
    """
    wanted = set(label_names)
    current = {lb.name: lb for lb in graph.labels_for_task(db, task.id) if lb.type == "label"}
    task_project_id = graph.project_id_of_task(db, task.id)

    for name in wanted - set(current):
        label = graph.find_label_by_name(db, task_project_id, name, label_type="label")
        if not label:
            label = graph.create_label(db, task_project_id, name=name, source="issue_sync")
        graph.set_label(db, task.id, label.id)

    for name, lb in current.items():
        if name not in wanted:
            graph.unset_label(db, task.id, lb.id)


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
    project = graph.get_project(db, project_id)
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
            graph.delete_task_tree(db, existing.id)
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
        changes: dict = {
            "title": normalized["title"],
            "description": normalized["description"],
            "external_url": normalized["external_url"],
        }
        if new_status != old_status:
            changes["status"] = new_status
        if normalized.get("assignee"):
            changes["assignee"] = normalized["assignee"]
        if "due_date" in normalized:
            changes["due_date"] = normalized["due_date"]
        # Labels and milestone are applied first so rules triggered by the field
        # update evaluate the task in its final inbound shape.
        _apply_external_labels(existing, normalized.get("labels", []), db)
        apply_inbound_milestone_cycle(existing, normalized.get("milestone"), db)
        # sync_external=False: this change came from the provider, so echoing it
        # back would loop. apply_task_update logs the status_changed/assigned
        # entries; the task.updated entry below stays for the sync itself.
        existing = await apply_task_update(
            db,
            existing.id,
            changes,
            actor=f"issue-sync:{provider}",
            source="issue-sync",
            project_id=project_id,
            activity_meta={"external_url": normalized["external_url"], "external_id": ext_id},
            sync_external=False,
            commit=False,
            broadcast=False,
        )

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
        await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": existing.id})
        return {"ok": True, "action": "updated", "task_id": existing.id}

    task = graph.create_task(
        db,
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
    _apply_external_labels(task, normalized.get("labels", []), db)
    apply_inbound_milestone_cycle(task, normalized.get("milestone"), db)

    await finalize_task_create(
        db,
        task.id,
        actor=f"issue-sync:{provider}",
        source="issue-sync",
        project_id=project_id,
        activity_meta={"external_url": normalized["external_url"], "external_id": ext_id},
    )
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


def _find_pr_tasks(pr_data: dict, project_id: str, db: Session) -> list:
    """Tasks referenced via 'Fixes #N' in the PR body, plus tasks already linked to this PR."""
    repo = pr_data["repo"]
    pr_number = str(pr_data["pr_number"])
    tasks: dict = {}

    for ref_num in pr_data.get("issue_refs", []):
        task = _find_external_task(project_id, "github", ref_num, repo, db)
        if task:
            tasks[task.id] = task

    contained = set(graph.contained_task_ids(db, project_id))
    links = (
        db.query(TaskPullRequest)
        .filter(
            TaskPullRequest.task_id.in_(contained),
            TaskPullRequest.repo == repo,
            TaskPullRequest.pr_number == pr_number,
        )
        .all()
    )
    for link in links:
        task = graph.get_task(db, link.task_id)
        if task is not None:
            tasks[link.task_id] = task

    return list(tasks.values())


def _upsert_pr_link(db: Session, task: "graph.TaskView", pr_data: dict, state: str | None) -> TaskPullRequest:
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
                # sync_external=False: the change originated on GitHub, so pushing
                # it back would echo. commit/broadcast are owned by this loop.
                await apply_task_update(
                    db,
                    task.id,
                    {"status": "in_progress"},
                    actor="pr-sync:github",
                    source="pr",
                    project_id=project_id,
                    activity_meta={"pr_url": pr_url, "pr_number": pr_number},
                    sync_external=False,
                    commit=False,
                    broadcast=False,
                )
                task.status = "in_progress"
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
                await apply_task_update(
                    db,
                    task.id,
                    {"status": "done"},
                    actor="pr-sync:github",
                    source="pr",
                    project_id=project_id,
                    activity_meta={"pr_url": pr_url, "pr_number": pr_number, "merged": True},
                    sync_external=False,
                    commit=False,
                    broadcast=False,
                )
                task.status = "done"
            affected_task_ids.append(task.id)

        # Legacy fallback: tasks whose description contains this PR URL
        # (from the pre-ADR-0016 description-append linking). description lives in
        # node.data (JSON), so scan the project's task nodes in Python.
        tasks_with_pr_url = [
            graph.task_view(n, db)
            for n in db.query(Node).filter(
                graph.task_type_filter(db),
                Node.id.in_(graph.contained_task_ids(db, project_id)),
                Node.status != "done",
            )
            if pr_url in ((n.data or {}).get("description") or "")
        ]
        for task in tasks_with_pr_url:
            if task.id not in affected_task_ids:
                await apply_task_update(
                    db,
                    task.id,
                    {"status": "done"},
                    actor="pr-sync:github",
                    source="pr",
                    project_id=project_id,
                    activity_meta={"pr_url": pr_url, "pr_number": pr_number, "merged": True, "legacy_link": True},
                    sync_external=False,
                    commit=False,
                    broadcast=False,
                )
                task.status = "done"
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


def _external_sync_target(task: "graph.TaskView", db: Session) -> tuple[str, str] | None:
    """Return (token, api_base_or_gitlab_url) when the task is linked and sync is configured."""
    if not task.external_provider or not task.external_id or not task.external_repo:
        return None
    integration = _get_sync_integration(graph.project_id_of_task(db, task.id), db)
    if not integration or not integration.secret:
        return None
    if task.external_provider == "github":
        return integration.secret, resolve_github_api_base(task.external_url, integration.url)
    if task.external_provider == "gitlab":
        return integration.secret, integration.url or "https://gitlab.com"
    return None


async def sync_task_closure_to_external(task: "graph.TaskView", db: Session) -> bool:
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


async def sync_task_reopen_to_external(task: "graph.TaskView", db: Session) -> bool:
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


async def sync_task_fields_to_external(task: "graph.TaskView", db: Session, changed: set[str]) -> bool:
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


async def sync_comment_to_external(comment: Comment, task: "graph.TaskView", db: Session) -> bool:
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


async def sync_comment_update_to_external(comment: Comment, task: "graph.TaskView", db: Session) -> bool:
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


async def sync_comment_delete_to_external(external_comment_id: str, task: "graph.TaskView", db: Session) -> bool:
    """Delete the linked external comment after a Shard comment is deleted."""
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    if task.external_provider == "github":
        return await delete_github_issue_comment(task.external_repo, external_comment_id, token, base)
    return await delete_gitlab_issue_note(task.external_repo, task.external_id, external_comment_id, token, base)


async def sync_labels_to_external(task: "graph.TaskView", db: Session) -> bool:
    """Replace the external issue's labels with the task's current plain-label set."""
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    names = [lb.name for lb in graph.labels_for_task(db, task.id) if lb.type == "label"]
    if task.external_provider == "github":
        return await replace_github_issue_labels(task.external_repo, task.external_id, names, token, base)
    return await replace_gitlab_issue_labels(task.external_repo, task.external_id, names, token, base)


def _task_primary_cycle(task: "graph.TaskView", db: Session) -> graph.CycleView | None:
    """The cycle whose milestone an issue should mirror.

    An external issue has a single milestone slot but a Shard task may sit in
    several cycles; the earliest-created cycle wins, deterministically.
    """
    cycles = graph.cycles_for_task(db, task.id)
    return cycles[0] if cycles else None


async def sync_task_milestone_to_external(task: "graph.TaskView", db: Session) -> bool:
    """Mirror the task's cycle membership onto the linked issue's milestone.

    Cycle name maps to milestone title, and the cycle's end_date to the milestone
    due date (ADR-0029). When the task is in no cycle, the milestone is cleared.
    Recomputes from current DB state, so add/remove both call this after commit.
    """
    target = _external_sync_target(task, db)
    if not target:
        return False
    token, base = target
    cycle = _task_primary_cycle(task, db)

    if task.external_provider == "github":
        if cycle is None:
            return await set_github_issue_milestone(task.external_repo, task.external_id, None, token, base)
        number = await find_or_create_github_milestone(
            task.external_repo, cycle.name, format_due_date_gitea(cycle.end_date), token, base
        )
        if number is None:
            return False
        return await set_github_issue_milestone(task.external_repo, task.external_id, number, token, base)

    if cycle is None:
        return await set_gitlab_issue_milestone(task.external_repo, task.external_id, 0, token, base)
    milestone_id = await find_or_create_gitlab_milestone(
        task.external_repo, cycle.name, format_due_date_gitlab(cycle.end_date), token, base
    )
    if milestone_id is None:
        return False
    return await set_gitlab_issue_milestone(task.external_repo, task.external_id, milestone_id, token, base)


def apply_inbound_milestone_cycle(task: "graph.TaskView", milestone_title: str | None, db: Session) -> None:
    """Add the task to the same-named cycle when an issue carries a milestone.

    Maps to an existing cycle only (never auto-creates one, ADR-0029) and is
    additive: a cleared milestone does not remove the task from any cycle, so
    inbound events cannot clobber manual Shard-side cycle assignment.
    """
    if not milestone_title:
        return
    project_id = graph.project_id_of_task(db, task.id)
    cycle = graph.find_cycle_by_name(db, project_id, milestone_title) if project_id else None
    if not cycle:
        return
    if task.id not in graph.task_ids_in_cycle(db, cycle.id):
        graph.add_to_cycle(db, cycle.id, task.id)


async def create_external_issue_from_task(
    task: "graph.TaskView", project: "graph.ProjectView", db: Session, provider: str | None = None
):
    """Create a new external issue from a Shard-origin task and link it back.

    Explicit user action (last-write-wins does not apply — the task is the source
    of truth here). Requires an active issue_sync integration with a token and a
    project repo URL. On success, sets the task's external_* fields so all later
    two-way sync (state, fields, comments, labels) flows through the usual paths.
    Raises ``ServiceError`` with an actionable message on any precondition failure, so
    the internal and v1 doors onto this act render the refusal identically (ADR-0085).
    """
    if task.external_id:
        raise ServiceError(409, "Task is already linked to an external issue")

    integration = _get_sync_integration(graph.project_id_of_task(db, task.id), db)
    if not integration or not integration.secret:
        raise Invalid("No active issue_sync integration with a token is configured for this project")

    parsed = parse_repo_url(project.repo_url or "", provider)
    if not parsed:
        raise Invalid("Project has no valid repo URL; set the project's repo URL first")

    token = integration.secret
    labels = [lb.name for lb in graph.labels_for_task(db, task.id) if lb.type == "label"]

    if parsed["provider"] == "github":
        result = await create_github_issue(
            parsed["repo"], task.title, task.description or "", labels, task.assignee, token, parsed["base"]
        )
    else:
        result = await create_gitlab_issue(
            parsed["repo"], task.title, task.description or "", labels, token, parsed["base"]
        )

    if not result:
        raise ServiceError(502, "External issue creation failed; check the token and repo URL")

    task = graph.update_task(
        db,
        task.id,
        external_provider=parsed["provider"],
        external_id=result["number"],
        external_url=result["url"],
        external_repo=parsed["repo"],
    )

    log_activity(
        db,
        "task.issue_created",
        project_id=graph.project_id_of_task(db, task.id),
        task_id=task.id,
        actor=f"issue-sync:{parsed['provider']}",
        detail=f'Created {parsed["provider"]} issue #{result["number"]} from task "{task.title}"',
        meta={"external_url": result["url"], "external_repo": parsed["repo"]},
    )
    db.commit()
    task = graph.get_task(db, task.id)
    await ws_manager.broadcast(
        "task.updated", {"project_id": graph.project_id_of_task(db, task.id), "task_id": task.id}
    )
    return enrich_task(task, db)
