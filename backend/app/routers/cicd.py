"""
CI/CD integration endpoints:
- Trigger pipelines from the platform
- Manage CI/CD sync configurations
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task
from app.services.activity import log_activity
from app.services.cicd_trigger import (
    trigger_generic_webhook,
    trigger_github_workflow,
    trigger_gitlab_pipeline,
    trigger_jenkins_build,
)

router = APIRouter(prefix="/cicd", tags=["cicd"])


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


@router.post("/trigger/github")
async def trigger_github(body: GitHubTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a GitHub Actions workflow."""
    result = await trigger_github_workflow(
        repo=body.repo,
        workflow_id=body.workflow_id,
        ref=body.ref,
        token=body.token,
        inputs=body.inputs,
        api_base=body.api_base,
    )

    if task_id:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            log_activity(
                db,
                "cicd.triggered",
                project_id=task.project_id,
                task_id=task.id,
                actor="user",
                detail=f"Triggered GitHub workflow '{body.workflow_id}' on {body.repo}@{body.ref}",
                meta={
                    "provider": "github",
                    "repo": body.repo,
                    "workflow": body.workflow_id,
                    "success": result.get("success"),
                },
            )
            db.commit()

    return result


@router.post("/trigger/gitlab")
async def trigger_gitlab(body: GitLabTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a GitLab CI/CD pipeline."""
    result = await trigger_gitlab_pipeline(
        project_id=body.project_id,
        ref=body.ref,
        token=body.token,
        variables=body.variables,
        gitlab_url=body.gitlab_url,
    )

    if task_id:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            log_activity(
                db,
                "cicd.triggered",
                project_id=task.project_id,
                task_id=task.id,
                actor="user",
                detail=f"Triggered GitLab pipeline for project {body.project_id}@{body.ref}",
                meta={"provider": "gitlab", "project_id": body.project_id, "success": result.get("success")},
            )
            db.commit()

    return result


@router.post("/trigger/jenkins")
async def trigger_jenkins(body: JenkinsTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a Jenkins build."""
    result = await trigger_jenkins_build(
        url=body.url,
        token=body.token,
        username=body.username,
        parameters=body.parameters,
    )

    if task_id:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            log_activity(
                db,
                "cicd.triggered",
                project_id=task.project_id,
                task_id=task.id,
                actor="user",
                detail=f"Triggered Jenkins build at {body.url}",
                meta={"provider": "jenkins", "url": body.url, "success": result.get("success")},
            )
            db.commit()

    return result


@router.post("/trigger/generic")
async def trigger_generic(body: GenericTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a generic webhook/pipeline."""
    result = await trigger_generic_webhook(
        url=body.url,
        method=body.method,
        headers=body.headers,
        body=body.body,
    )

    if task_id:
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            log_activity(
                db,
                "cicd.triggered",
                project_id=task.project_id,
                task_id=task.id,
                actor="user",
                detail=f"Triggered {body.method} {body.url}",
                meta={"provider": "generic", "url": body.url, "success": result.get("success")},
            )
            db.commit()

    return result
