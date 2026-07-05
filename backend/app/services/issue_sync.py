"""
GitHub / GitLab issue synchronization service.

Inbound: Webhook payloads from GitHub/GitLab create or update Shard tasks.
Outbound: When Shard tasks are completed, the corresponding external issue is closed.
Also handles GitHub pull request events for PR-to-task linking.
"""

import logging
import re
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


def resolve_github_api_base(external_url: str | None = None, integration_url: str | None = None) -> str:
    """Resolve the GitHub-compatible API base for github.com, GitHub Enterprise, or Gitea.

    Gitea and GitHub Enterprise expose the same ``/repos/{owner}/{repo}/...`` REST
    shape as github.com, only under a different base URL. Priority:

    1. ``integration_url`` when it already points at an API base (contains ``/api/``),
       so power users can target GHE (``/api/v3``) or a custom mount explicitly.
    2. Host derived from the issue's ``external_url`` (github.com -> api.github.com,
       any other host -> ``{scheme}://{host}/api/v1`` for Gitea-compatible servers).
    3. Default ``https://api.github.com``.
    """
    if integration_url and "/api/" in integration_url:
        return integration_url.rstrip("/")

    for candidate in (external_url, integration_url):
        if not candidate:
            continue
        parsed = urlparse(candidate)
        host = parsed.netloc
        if not host:
            continue
        if host in ("github.com", "www.github.com", "api.github.com"):
            return GITHUB_API_BASE
        scheme = parsed.scheme or "https"
        return f"{scheme}://{host}/api/v1"

    return GITHUB_API_BASE


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


_ISSUE_REF_PATTERN = re.compile(
    r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)",
    re.IGNORECASE,
)


def parse_issue_refs(text: str) -> list[str]:
    """Extract issue numbers from 'Fixes #N' / 'Closes #N' / 'Resolves #N' patterns."""
    if not text:
        return []
    return _ISSUE_REF_PATTERN.findall(text)


def normalize_github_pr(payload: dict) -> dict | None:
    """Extract normalized PR data from a GitHub pull_request webhook payload."""
    action = payload.get("action")
    pr = payload.get("pull_request")
    if not pr:
        return None

    merged = bool(pr.get("merged"))

    return {
        "type": "pull_request",
        "action": action,
        "pr_number": pr.get("number"),
        "pr_url": pr.get("html_url", ""),
        "pr_title": pr.get("title", ""),
        "branch": (pr.get("head") or {}).get("ref", ""),
        "merged": merged,
        "repo": payload.get("repository", {}).get("full_name", ""),
        "body": pr.get("body") or "",
        "issue_refs": parse_issue_refs(pr.get("body") or ""),
    }


def detect_pr_webhook(headers: dict, payload: dict) -> dict | None:
    """Detect a GitHub pull_request webhook event and normalize it."""
    gh_event = headers.get("x-github-event", "")
    if gh_event == "pull_request":
        return normalize_github_pr(payload)
    return None


def detect_issue_webhook(headers: dict, payload: dict) -> dict | None:
    """Auto-detect provider and normalize issue webhook payload."""
    gh_event = headers.get("x-github-event", "")
    if gh_event == "issues":
        return normalize_github_issue(payload)

    gl_event = headers.get("x-gitlab-event", "")
    if gl_event in ("Issue Hook", "issue"):
        return normalize_gitlab_issue(payload)

    return None


async def close_github_issue(repo: str, issue_number: str, token: str, api_base: str = GITHUB_API_BASE) -> bool:
    """Close an issue via the GitHub-compatible API (github.com, GHE, or Gitea)."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.patch(url, json={"state": "closed"}, headers=headers)
        if resp.is_success:
            logger.info("Closed issue %s#%s via %s", repo, issue_number, api_base)
            return True
        logger.warning("Failed to close issue %s#%s via %s: %s", repo, issue_number, api_base, resp.status_code)
        return False
    except httpx.HTTPError as exc:
        logger.warning("Error closing issue %s#%s via %s: %s", repo, issue_number, api_base, exc)
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
