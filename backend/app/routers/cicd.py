"""CI/CD outbound triggers — start a pipeline from the platform.

Thin over ``services/cicd_dispatch``, which ``/api/v1/cicd`` calls too (ADR-0085).
Inbound callbacks are ``routers/webhooks.py``; the credentials they are signed with are
``services/webhook_credentials``.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import cicd_dispatch
from app.services.cicd_dispatch import GenericTrigger, GitHubTrigger, GitLabTrigger, JenkinsTrigger

router = APIRouter(prefix="/cicd", tags=["cicd"])


@router.post("/trigger/github")
async def trigger_github(body: GitHubTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a GitHub Actions workflow."""
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor="user")


@router.post("/trigger/gitlab")
async def trigger_gitlab(body: GitLabTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a GitLab CI/CD pipeline."""
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor="user")


@router.post("/trigger/jenkins")
async def trigger_jenkins(body: JenkinsTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a Jenkins build."""
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor="user")


@router.post("/trigger/generic")
async def trigger_generic(body: GenericTrigger, task_id: str | None = None, db: Session = Depends(get_db)):
    """Trigger a generic webhook/pipeline."""
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor="user")
