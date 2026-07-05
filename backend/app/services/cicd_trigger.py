"""
Bidirectional CI/CD sync: trigger pipelines from the platform.
Supports GitHub Actions (workflow_dispatch), GitLab CI (pipeline trigger),
Jenkins (build trigger), and generic webhook triggers.
"""

import logging

import httpx

logger = logging.getLogger(__name__)


async def trigger_github_workflow(
    repo: str,
    workflow_id: str,
    ref: str = "main",
    token: str = "",
    inputs: dict | None = None,
    api_base: str = "https://api.github.com",
) -> dict:
    """
    Trigger a workflow via the GitHub-compatible Actions API (github.com, GHE, or Gitea).
    repo: "owner/repo"
    workflow_id: workflow filename or ID
    api_base: API base URL, e.g. "https://api.github.com" or "https://gitea.example.com/api/v1"
    """
    url = f"{api_base.rstrip('/')}/repos/{repo}/actions/workflows/{workflow_id}/dispatches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    body = {"ref": ref}
    if inputs:
        body["inputs"] = inputs

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=body, headers=headers)
        if resp.status_code == 204:
            return {"success": True, "message": f"Workflow {workflow_id} triggered on {ref}"}
        return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    except httpx.HTTPError as exc:
        return {"success": False, "error": str(exc)}


async def trigger_gitlab_pipeline(
    project_id: str,
    ref: str = "main",
    token: str = "",
    variables: dict | None = None,
    gitlab_url: str = "https://gitlab.com",
) -> dict:
    """
    Trigger a GitLab CI/CD pipeline via API.
    project_id: numeric or URL-encoded project path
    """
    url = f"{gitlab_url}/api/v4/projects/{project_id}/pipeline"
    headers = {"PRIVATE-TOKEN": token}
    body = {"ref": ref}
    if variables:
        body["variables"] = [{"key": k, "value": v} for k, v in variables.items()]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=body, headers=headers)
        if resp.is_success:
            data = resp.json()
            return {"success": True, "pipeline_id": data.get("id"), "web_url": data.get("web_url")}
        return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    except httpx.HTTPError as exc:
        return {"success": False, "error": str(exc)}


async def trigger_jenkins_build(
    url: str,
    token: str = "",
    username: str = "",
    parameters: dict | None = None,
) -> dict:
    """
    Trigger a Jenkins build via Remote Build Trigger or Build with Parameters.
    url: Jenkins job URL (e.g., https://jenkins.example.com/job/my-job)
    """
    import base64

    build_url = f"{url.rstrip('/')}/build" if not parameters else f"{url.rstrip('/')}/buildWithParameters"
    headers = {}
    if username and token:
        creds = base64.b64encode(f"{username}:{token}".encode()).decode()
        headers["Authorization"] = f"Basic {creds}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(build_url, params=parameters or {}, headers=headers)
        if resp.status_code in (200, 201):
            return {"success": True, "message": "Build triggered"}
        # Jenkins returns 201 with Location header for queued builds
        if resp.status_code == 201 or resp.status_code == 302:
            location = resp.headers.get("location", "")
            return {"success": True, "queue_url": location}
        return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    except httpx.HTTPError as exc:
        return {"success": False, "error": str(exc)}


async def trigger_generic_webhook(
    url: str,
    method: str = "POST",
    headers: dict | None = None,
    body: dict | None = None,
) -> dict:
    """Trigger a generic webhook endpoint."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if method.upper() == "POST":
                resp = await client.post(url, json=body or {}, headers=headers or {})
            elif method.upper() == "GET":
                resp = await client.get(url, headers=headers or {})
            else:
                resp = await client.request(method.upper(), url, json=body or {}, headers=headers or {})
        return {
            "success": resp.is_success,
            "status_code": resp.status_code,
            "body": resp.text[:500],
        }
    except httpx.HTTPError as exc:
        return {"success": False, "error": str(exc)}
