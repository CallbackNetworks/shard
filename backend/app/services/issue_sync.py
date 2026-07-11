"""
GitHub / GitLab issue synchronization service.

Inbound: Webhook payloads from GitHub/GitLab create or update Shard tasks,
comments, and labels.
Outbound: Task completion closes the external issue, reopening reopens it,
comment create/edit/delete and label changes are pushed back.
Also handles GitHub pull request events for PR-to-task linking.
"""

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


def parse_due_date(value) -> datetime | None:
    """Parse a provider due date ("YYYY-MM-DD" or RFC3339) into an aware datetime.

    Gitea sends RFC3339 ("2026-07-20T00:00:00Z"), GitLab sends a plain date
    ("2026-07-20"). Returns None for missing/blank/unparseable values.
    """
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def format_due_date_gitlab(due: datetime | None) -> str:
    """GitLab wants a plain date; empty string clears the field."""
    return due.date().isoformat() if due else ""


def format_due_date_gitea(due: datetime | None) -> str | None:
    """Gitea/RFC3339 due date; None clears the field."""
    return due.astimezone(UTC).isoformat().replace("+00:00", "Z") if due else None


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
        # github.com issues have no due date; Gitea includes "due_date" here.
        "due_date": parse_due_date(issue.get("due_date")),
        # github.com and Gitea both nest the milestone object with its title.
        "milestone": (issue.get("milestone") or {}).get("title"),
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
        "due_date": parse_due_date(attrs.get("due_date")),
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


def normalize_github_pr_review(payload: dict) -> dict | None:
    """Extract normalized review data from a GitHub pull_request_review webhook payload."""
    review = payload.get("review")
    pr = payload.get("pull_request")
    if not review or not pr:
        return None

    return {
        "type": "pull_request_review",
        "action": payload.get("action", ""),  # submitted / edited / dismissed
        "review_state": (review.get("state") or "").lower(),  # approved / changes_requested / commented
        "reviewer": (review.get("user") or {}).get("login"),
        "pr_number": pr.get("number"),
        "pr_url": pr.get("html_url", ""),
        "pr_title": pr.get("title", ""),
        "repo": payload.get("repository", {}).get("full_name", ""),
        "issue_refs": parse_issue_refs(pr.get("body") or ""),
    }


def detect_pr_review_webhook(headers: dict, payload: dict) -> dict | None:
    """Detect a GitHub pull_request_review webhook event and normalize it."""
    gh_event = headers.get("x-github-event", "")
    if gh_event == "pull_request_review":
        return normalize_github_pr_review(payload)
    return None


def normalize_github_comment(payload: dict) -> dict | None:
    """Extract normalized comment data from a GitHub issue_comment webhook payload."""
    comment = payload.get("comment")
    issue = payload.get("issue")
    if not comment or not issue:
        return None

    return {
        "provider": "github",
        "action": payload.get("action", "created"),  # created / edited / deleted
        "comment_id": str(comment["id"]),
        "body": comment.get("body") or "",
        "author": (comment.get("user") or {}).get("login"),
        "issue_id": str(issue["number"]),
        "url": comment.get("html_url", ""),
        "repo": payload.get("repository", {}).get("full_name", ""),
    }


def normalize_gitlab_note(payload: dict) -> dict | None:
    """Extract normalized comment data from a GitLab Note Hook payload (issue notes only)."""
    attrs = payload.get("object_attributes")
    if not attrs or attrs.get("noteable_type") != "Issue":
        return None

    issue = payload.get("issue") or {}
    action = {"create": "created", "update": "edited"}.get(attrs.get("action"), "created")

    return {
        "provider": "gitlab",
        "action": action,
        "comment_id": str(attrs.get("id", "")),
        "body": attrs.get("note") or "",
        "author": (payload.get("user") or {}).get("username"),
        "issue_id": str(issue.get("iid", "")),
        "url": attrs.get("url", ""),
        "repo": payload.get("project", {}).get("path_with_namespace", ""),
    }


def detect_comment_webhook(headers: dict, payload: dict) -> dict | None:
    """Auto-detect provider and normalize an issue-comment webhook payload."""
    gh_event = headers.get("x-github-event", "")
    if gh_event == "issue_comment":
        return normalize_github_comment(payload)

    gl_event = headers.get("x-gitlab-event", "")
    if gl_event in ("Note Hook", "note"):
        return normalize_gitlab_note(payload)

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


def _github_headers(token: str) -> dict:
    return {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }


async def _github_request(
    method: str, url: str, token: str, json_body: dict | None, what: str
) -> httpx.Response | None:
    """Fire a GitHub-compatible API request, returning the response or None on transport error."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.request(method, url, json=json_body, headers=_github_headers(token))
        if not resp.is_success:
            logger.warning("Failed to %s via %s: %s", what, url, resp.status_code)
        return resp
    except httpx.HTTPError as exc:
        logger.warning("Error on %s via %s: %s", what, url, exc)
        return None


def _gitlab_project_url(project_path: str, gitlab_url: str) -> str:
    import urllib.parse

    encoded_path = urllib.parse.quote(project_path, safe="")
    return f"{gitlab_url}/api/v4/projects/{encoded_path}"


async def _gitlab_request(
    method: str, url: str, token: str, json_body: dict | None, what: str
) -> httpx.Response | None:
    """Fire a GitLab API request, returning the response or None on transport error."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.request(method, url, json=json_body, headers={"PRIVATE-TOKEN": token})
        if not resp.is_success:
            logger.warning("Failed to %s via %s: %s", what, url, resp.status_code)
        return resp
    except httpx.HTTPError as exc:
        logger.warning("Error on %s via %s: %s", what, url, exc)
        return None


async def set_github_issue_state(
    repo: str, issue_number: str, state: str, token: str, api_base: str = GITHUB_API_BASE
) -> bool:
    """Set an issue's state ("open" or "closed") via the GitHub-compatible API (github.com, GHE, or Gitea)."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}"
    resp = await _github_request("PATCH", url, token, {"state": state}, f"set issue {repo}#{issue_number} {state}")
    if resp is not None and resp.is_success:
        logger.info("Set issue %s#%s state=%s via %s", repo, issue_number, state, api_base)
        return True
    return False


async def close_github_issue(repo: str, issue_number: str, token: str, api_base: str = GITHUB_API_BASE) -> bool:
    """Close an issue via the GitHub-compatible API (github.com, GHE, or Gitea)."""
    return await set_github_issue_state(repo, issue_number, "closed", token, api_base)


async def reopen_github_issue(repo: str, issue_number: str, token: str, api_base: str = GITHUB_API_BASE) -> bool:
    """Reopen an issue via the GitHub-compatible API (github.com, GHE, or Gitea)."""
    return await set_github_issue_state(repo, issue_number, "open", token, api_base)


async def set_gitlab_issue_state(
    project_path: str, issue_iid: str, state_event: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Apply a state event ("close" or "reopen") to a GitLab issue via the API."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}"
    resp = await _gitlab_request(
        "PUT", url, token, {"state_event": state_event}, f"{state_event} GitLab issue {project_path}#{issue_iid}"
    )
    if resp is not None and resp.is_success:
        logger.info("Applied %s to GitLab issue %s#%s", state_event, project_path, issue_iid)
        return True
    return False


async def close_gitlab_issue(
    project_path: str, issue_iid: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Close a GitLab issue via the API."""
    return await set_gitlab_issue_state(project_path, issue_iid, "close", token, gitlab_url)


async def reopen_gitlab_issue(
    project_path: str, issue_iid: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Reopen a GitLab issue via the API."""
    return await set_gitlab_issue_state(project_path, issue_iid, "reopen", token, gitlab_url)


async def update_github_issue_fields(
    repo: str, issue_number: str, payload: dict, token: str, api_base: str = GITHUB_API_BASE
) -> bool:
    """Update issue fields (title, body, assignees) via the GitHub-compatible API."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}"
    resp = await _github_request("PATCH", url, token, payload, f"update fields on {repo}#{issue_number}")
    return resp is not None and resp.is_success


async def update_gitlab_issue_fields(
    project_path: str, issue_iid: str, payload: dict, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Update issue fields (title, description, assignee_ids) via the GitLab API."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}"
    resp = await _gitlab_request("PUT", url, token, payload, f"update fields on GitLab {project_path}#{issue_iid}")
    return resp is not None and resp.is_success


async def lookup_gitlab_user_id(username: str, token: str, gitlab_url: str = "https://gitlab.com") -> int | None:
    """Resolve a GitLab username to its numeric user id (needed for assignee_ids)."""
    url = f"{gitlab_url}/api/v4/users?username={username}"
    resp = await _gitlab_request("GET", url, token, None, f"lookup GitLab user {username}")
    if resp is not None and resp.is_success:
        users = resp.json()
        if users:
            return users[0].get("id")
    return None


async def create_github_issue_comment(
    repo: str, issue_number: str, body: str, token: str, api_base: str = GITHUB_API_BASE
) -> str | None:
    """Post a comment on a GitHub-compatible issue. Returns the external comment id on success."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}/comments"
    resp = await _github_request("POST", url, token, {"body": body}, f"comment on {repo}#{issue_number}")
    if resp is not None and resp.is_success:
        return str(resp.json().get("id", "")) or None
    return None


async def update_github_issue_comment(
    repo: str, comment_id: str, body: str, token: str, api_base: str = GITHUB_API_BASE
) -> bool:
    """Edit an existing comment via the GitHub-compatible API."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/comments/{comment_id}"
    resp = await _github_request("PATCH", url, token, {"body": body}, f"edit comment {comment_id} on {repo}")
    return resp is not None and resp.is_success


async def delete_github_issue_comment(repo: str, comment_id: str, token: str, api_base: str = GITHUB_API_BASE) -> bool:
    """Delete a comment via the GitHub-compatible API."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/comments/{comment_id}"
    resp = await _github_request("DELETE", url, token, None, f"delete comment {comment_id} on {repo}")
    return resp is not None and resp.is_success


async def create_gitlab_issue_note(
    project_path: str, issue_iid: str, body: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> str | None:
    """Post a note on a GitLab issue. Returns the external note id on success."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}/notes"
    resp = await _gitlab_request("POST", url, token, {"body": body}, f"note on GitLab {project_path}#{issue_iid}")
    if resp is not None and resp.is_success:
        return str(resp.json().get("id", "")) or None
    return None


async def update_gitlab_issue_note(
    project_path: str, issue_iid: str, note_id: str, body: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Edit an existing note on a GitLab issue."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}/notes/{note_id}"
    resp = await _gitlab_request("PUT", url, token, {"body": body}, f"edit note {note_id} on {project_path}")
    return resp is not None and resp.is_success


async def delete_gitlab_issue_note(
    project_path: str, issue_iid: str, note_id: str, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Delete a note from a GitLab issue."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}/notes/{note_id}"
    resp = await _gitlab_request("DELETE", url, token, None, f"delete note {note_id} on {project_path}")
    return resp is not None and resp.is_success


async def replace_github_issue_labels(
    repo: str, issue_number: str, labels: list[str], token: str, api_base: str = GITHUB_API_BASE
) -> bool:
    """Replace the label set of a GitHub-compatible issue with the given names.

    github.com accepts label names directly; Gitea accepts names since 1.20.
    """
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}/labels"
    resp = await _github_request("PUT", url, token, {"labels": labels}, f"set labels on {repo}#{issue_number}")
    return resp is not None and resp.is_success


async def replace_gitlab_issue_labels(
    project_path: str, issue_iid: str, labels: list[str], token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Replace the label set of a GitLab issue with the given names."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}"
    resp = await _gitlab_request(
        "PUT", url, token, {"labels": ",".join(labels)}, f"set labels on GitLab {project_path}#{issue_iid}"
    )
    return resp is not None and resp.is_success


def parse_repo_url(repo_url: str, provider: str | None = None) -> dict | None:
    """Parse a project repo URL into the pieces needed to create an issue.

    Returns ``{provider, repo, host, base}`` where ``repo`` is ``owner/name`` for
    GitHub-compatible hosts (github.com, GHE, Gitea) or the full namespace path
    for GitLab, and ``base`` is the API base / GitLab root URL. Provider defaults
    to gitlab when the host looks like GitLab, otherwise GitHub-compatible; pass
    ``provider`` explicitly to override (e.g. self-hosted GitLab on a plain host).
    """
    if not repo_url:
        return None
    parsed = urlparse(repo_url if "://" in repo_url else f"https://{repo_url}")
    host = parsed.netloc
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    if not host or not path:
        return None

    if provider is None:
        provider = "gitlab" if "gitlab" in host.lower() else "github"

    scheme = parsed.scheme or "https"
    if provider == "gitlab":
        return {"provider": "gitlab", "repo": path, "host": host, "base": f"{scheme}://{host}"}

    segments = path.split("/")
    if len(segments) < 2:
        return None
    repo = "/".join(segments[:2])
    return {"provider": "github", "repo": repo, "host": host, "base": resolve_github_api_base(repo_url)}


async def create_github_issue(
    repo: str,
    title: str,
    body: str,
    labels: list[str],
    assignee: str | None,
    token: str,
    api_base: str = GITHUB_API_BASE,
) -> dict | None:
    """Create a new issue via the GitHub-compatible API. Returns {number, url} on success."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues"
    payload: dict = {"title": title, "body": body or ""}
    if labels:
        payload["labels"] = labels
    if assignee:
        payload["assignees"] = [assignee]
    resp = await _github_request("POST", url, token, payload, f"create issue in {repo}")
    if resp is not None and resp.is_success:
        data = resp.json()
        return {"number": str(data.get("number", "")), "url": data.get("html_url", "")}
    return None


async def create_gitlab_issue(
    project_path: str,
    title: str,
    description: str,
    labels: list[str],
    token: str,
    gitlab_url: str = "https://gitlab.com",
) -> dict | None:
    """Create a new issue via the GitLab API. Returns {number, url} on success."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues"
    payload: dict = {"title": title, "description": description or ""}
    if labels:
        payload["labels"] = ",".join(labels)
    resp = await _gitlab_request("POST", url, token, payload, f"create issue in {project_path}")
    if resp is not None and resp.is_success:
        data = resp.json()
        return {"number": str(data.get("iid", "")), "url": data.get("web_url", "")}
    return None


async def find_or_create_github_milestone(
    repo: str, title: str, due_on: str | None, token: str, api_base: str = GITHUB_API_BASE
) -> int | None:
    """Find a milestone by title (any state) or create it. Returns its number.

    github.com and Gitea share the same milestones REST shape; `due_on` is RFC3339.
    """
    base = api_base.rstrip("/")
    resp = await _github_request(
        "GET", f"{base}/repos/{repo}/milestones?state=all&per_page=100", token, None, f"list milestones in {repo}"
    )
    if resp is not None and resp.is_success:
        for m in resp.json():
            if m.get("title") == title:
                return m.get("number")
    payload: dict = {"title": title}
    if due_on:
        payload["due_on"] = due_on
    resp = await _github_request(
        "POST", f"{base}/repos/{repo}/milestones", token, payload, f"create milestone {title!r} in {repo}"
    )
    if resp is not None and resp.is_success:
        return resp.json().get("number")
    return None


async def set_github_issue_milestone(
    repo: str, issue_number: str, milestone_number: int | None, token: str, api_base: str = GITHUB_API_BASE
) -> bool:
    """Set (or clear, with None) an issue's milestone via the GitHub-compatible API."""
    url = f"{api_base.rstrip('/')}/repos/{repo}/issues/{issue_number}"
    resp = await _github_request(
        "PATCH", url, token, {"milestone": milestone_number}, f"set milestone on {repo}#{issue_number}"
    )
    return resp is not None and resp.is_success


async def find_or_create_gitlab_milestone(
    project_path: str, title: str, due_date: str | None, token: str, gitlab_url: str = "https://gitlab.com"
) -> int | None:
    """Find a project milestone by title or create it. Returns its id. `due_date` is YYYY-MM-DD."""
    import urllib.parse

    base = _gitlab_project_url(project_path, gitlab_url)
    resp = await _gitlab_request(
        "GET",
        f"{base}/milestones?title={urllib.parse.quote(title)}",
        token,
        None,
        f"list milestones in {project_path}",
    )
    if resp is not None and resp.is_success:
        for m in resp.json():
            if m.get("title") == title:
                return m.get("id")
    payload: dict = {"title": title}
    if due_date:
        payload["due_date"] = due_date
    resp = await _gitlab_request("POST", f"{base}/milestones", token, payload, f"create milestone {title!r}")
    if resp is not None and resp.is_success:
        return resp.json().get("id")
    return None


async def set_gitlab_issue_milestone(
    project_path: str, issue_iid: str, milestone_id: int, token: str, gitlab_url: str = "https://gitlab.com"
) -> bool:
    """Set an issue's milestone via the GitLab API. Pass milestone_id=0 to unassign."""
    url = f"{_gitlab_project_url(project_path, gitlab_url)}/issues/{issue_iid}"
    resp = await _gitlab_request(
        "PUT", url, token, {"milestone_id": milestone_id}, f"set milestone on GitLab {project_path}#{issue_iid}"
    )
    return resp is not None and resp.is_success
