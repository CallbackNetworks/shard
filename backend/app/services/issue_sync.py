"""
GitHub / GitLab issue synchronization service.

Inbound: Webhook payloads from GitHub/GitLab create or update Shard tasks.
Outbound: When Shard tasks are completed, the corresponding external issue is closed.
"""

import logging

import httpx

logger = logging.getLogger(__name__)


def normalize_github_issue(payload: dict) -> dict | None:
    """Extract normalized issue data from a GitHub webhook payload."""
    action = payload.get("action")
    issue = payload.get("issue")
    if not issue:
        return None

    status = "todo"
    if issue.get("state") == "closed":
        status = "done"
    elif any(lb.get("name", "").lower() in ("in progress", "wip") for lb in issue.get("labels", [])):
        status = "in_progress"

    return {
        "provider": "github",
        "action": action,
        "external_id": str(issue["number"]),
        "external_url": issue.get("html_url", ""),
        "title": issue.get("title", ""),
        "description": issue.get("body") or "",
        "status": status,
        "labels": [lb["name"] for lb in issue.get("labels", [])],
        "assignee": issue.get("assignee", {}).get("login") if issue.get("assignee") else None,
        "repo": payload.get("repository", {}).get("full_name", ""),
    }


def normalize_gitlab_issue(payload: dict) -> dict | None:
    """Extract normalized issue data from a GitLab webhook payload."""
    attrs = payload.get("object_attributes")
    if not attrs:
        return None

    action = attrs.get("action", payload.get("event_type", ""))
    status = "todo"
    if attrs.get("state") == "closed":
        status = "done"
    elif any(lb.get("title", "").lower() in ("in progress", "wip", "doing") for lb in payload.get("labels", [])):
        status = "in_progress"

    return {
        "provider": "gitlab",
        "action": action,
        "external_id": str(attrs.get("iid", attrs.get("id", ""))),
        "external_url": attrs.get("url", ""),
        "title": attrs.get("title", ""),
        "description": attrs.get("description") or "",
        "status": status,
        "labels": [lb["title"] for lb in payload.get("labels", [])],
        "assignee": (payload.get("assignees") or [{}])[0].get("username") if payload.get("assignees") else None,
        "repo": payload.get("project", {}).get("path_with_namespace", ""),
    }


def detect_issue_webhook(headers: dict, payload: dict) -> dict | None:
    """Auto-detect provider and normalize issue webhook payload."""
    gh_event = headers.get("x-github-event", "")
    if gh_event == "issues":
        return normalize_github_issue(payload)

    gl_event = headers.get("x-gitlab-event", "")
    if gl_event in ("Issue Hook", "issue"):
        return normalize_gitlab_issue(payload)

    return None


async def close_github_issue(repo: str, issue_number: str, token: str) -> bool:
    """Close a GitHub issue via the API."""
    url = f"https://api.github.com/repos/{repo}/issues/{issue_number}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.patch(url, json={"state": "closed"}, headers=headers)
        if resp.is_success:
            logger.info("Closed GitHub issue %s#%s", repo, issue_number)
            return True
        logger.warning("Failed to close GitHub issue %s#%s: %s", repo, issue_number, resp.status_code)
        return False
    except httpx.HTTPError as exc:
        logger.warning("Error closing GitHub issue %s#%s: %s", repo, issue_number, exc)
        return False


async def close_gitlab_issue(
    project_path: str, issue_iid: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Close a GitLab issue via the API."""
    import urllib.parse

    encoded_path = urllib.parse.quote(project_path, safe="")
    url = f"{gitlab_url}/api/v4/projects/{encoded_path}/issues/{issue_iid}"
    headers = {"PRIVATE-TOKEN": token}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.put(url, json={"state_event": "close"}, headers=headers)
        if resp.is_success:
            logger.info("Closed GitLab issue %s#%s", project_path, issue_iid)
            return True
        logger.warning("Failed to close GitLab issue %s#%s: %s", project_path, issue_iid, resp.status_code)
        return False
    except httpx.HTTPError as exc:
        logger.warning("Error closing GitLab issue %s#%s: %s", project_path, issue_iid, exc)
        return False
