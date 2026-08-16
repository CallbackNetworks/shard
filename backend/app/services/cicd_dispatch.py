"""Triggering a pipeline, for both doors (ADR-0085).

The third direction of the CI/CD story. ADR-0084 gave an agent the credentials to *receive*
build results; this is the one that starts the build. It was internal-only, which in
production means a person in a browser — the same asymmetry, one endpoint over.

The four providers differ only in what they need to address a pipeline. Everything after
that is identical — call the adapter, and if the caller named a task, record that the
trigger happened against it — so that half lives here once rather than four times in two
routers.

The provider token travels *in* the request and is never stored. That is deliberate: this
system does not hold the credentials of the systems it triggers, so there is nothing here
to leak later, and nothing to rotate. The caller supplies it per call.
"""

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services import graph
from app.services.activity import log_activity
from app.services.cicd_trigger import (
    trigger_generic_webhook,
    trigger_github_workflow,
    trigger_gitlab_pipeline,
    trigger_jenkins_build,
)


class GitHubTrigger(BaseModel):
    repo: str  # "owner/repo"
    workflow_id: str  # workflow filename or ID
    ref: str = "main"
    token: str  # GitHub personal access token
    inputs: dict | None = None
    api_base: str = "https://api.github.com"  # e.g. "https://gitea.example.com/api/v1" for Gitea


class GitLabTrigger(BaseModel):
    project_id: str  # numeric or URL-encoded
    ref: str = "main"
    token: str  # GitLab private token or trigger token
    variables: dict | None = None
    gitlab_url: str = "https://gitlab.com"


class JenkinsTrigger(BaseModel):
    url: str  # Jenkins job URL
    token: str = ""  # API token
    username: str = ""  # Jenkins username
    parameters: dict | None = None


class GenericTrigger(BaseModel):
    url: str
    method: str = "POST"
    headers: dict | None = None
    body: dict | None = None


async def _run(body) -> tuple[dict, str, dict]:
    """Call the right adapter. Returns the result plus how to describe it in the log."""
    if isinstance(body, GitHubTrigger):
        result = await trigger_github_workflow(
            repo=body.repo,
            workflow_id=body.workflow_id,
            ref=body.ref,
            token=body.token,
            inputs=body.inputs,
            api_base=body.api_base,
        )
        return (
            result,
            f"Triggered GitHub workflow '{body.workflow_id}' on {body.repo}@{body.ref}",
            {"provider": "github", "repo": body.repo, "workflow": body.workflow_id},
        )
    if isinstance(body, GitLabTrigger):
        result = await trigger_gitlab_pipeline(
            project_id=body.project_id,
            ref=body.ref,
            token=body.token,
            variables=body.variables,
            gitlab_url=body.gitlab_url,
        )
        return (
            result,
            f"Triggered GitLab pipeline for project {body.project_id}@{body.ref}",
            {"provider": "gitlab", "project_id": body.project_id},
        )
    if isinstance(body, JenkinsTrigger):
        result = await trigger_jenkins_build(
            url=body.url,
            token=body.token,
            username=body.username,
            parameters=body.parameters,
        )
        return (
            result,
            f"Triggered Jenkins build at {body.url}",
            {"provider": "jenkins", "url": body.url},
        )
    result = await trigger_generic_webhook(
        url=body.url,
        method=body.method,
        headers=body.headers,
        body=body.body,
    )
    return (
        result,
        f"Triggered {body.method} {body.url}",
        {"provider": "generic", "url": body.url},
    )


async def trigger(db: Session, body, *, task_id: str | None, actor: str) -> dict:
    """Start a pipeline, and record it against a task if one was named."""
    result, detail, meta = await _run(body)
    if task_id:
        task = graph.get_task(db, task_id)
        if task:
            log_activity(
                db,
                "cicd.triggered",
                project_id=graph.project_id_of_task(db, task.id),
                task_id=task.id,
                actor=actor,
                detail=detail,
                meta={**meta, "success": result.get("success")},
            )
            db.commit()
    return result
