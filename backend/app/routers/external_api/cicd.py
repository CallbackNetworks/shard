"""External API v1 — start a CI/CD pipeline (ADR-0085).

The third direction of CI/CD, and the last one to get an agent-reachable door. ADR-0084
covered receiving build results; ``/subscriptions`` covers being notified of platform
events; this starts the build. All three were internal-only or absent, which in production
meant the agent that had just finished the code could not run the pipeline for it.

``write`` scope. Triggering a build has an external effect, but it is an effect on a system
whose credentials the caller supplies in the request — this platform stores nothing and
grants nothing here, so it is an ordinary write, not the administrative act that handing
out *our* callback credentials is.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _build_actor, _get_api_key, _require_scope
from app.services import cicd_dispatch
from app.services.cicd_dispatch import GenericTrigger, GitHubTrigger, GitLabTrigger, JenkinsTrigger

sub_router = APIRouter()

_TRIGGER_DESCRIPTION = (
    "Starts a pipeline on the named provider. The provider's own credential travels in the "
    "request body and is never stored — supply it per call. Pass `task_id` to record the "
    "trigger against a task's activity, which is how a build gets tied to the work that "
    "caused it. Requires `write` scope."
)


@sub_router.post(
    "/cicd/trigger/github",
    summary="Trigger a GitHub Actions workflow",
    description=_TRIGGER_DESCRIPTION,
    responses=_auth_errors,
)
async def api_trigger_github(
    body: GitHubTrigger,
    task_id: str | None = None,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor=_build_actor(api_key))


@sub_router.post(
    "/cicd/trigger/gitlab",
    summary="Trigger a GitLab CI/CD pipeline",
    description=_TRIGGER_DESCRIPTION,
    responses=_auth_errors,
)
async def api_trigger_gitlab(
    body: GitLabTrigger,
    task_id: str | None = None,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor=_build_actor(api_key))


@sub_router.post(
    "/cicd/trigger/jenkins",
    summary="Trigger a Jenkins build",
    description=_TRIGGER_DESCRIPTION,
    responses=_auth_errors,
)
async def api_trigger_jenkins(
    body: JenkinsTrigger,
    task_id: str | None = None,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor=_build_actor(api_key))


@sub_router.post(
    "/cicd/trigger/generic",
    summary="Trigger a generic webhook pipeline",
    description=_TRIGGER_DESCRIPTION,
    responses=_auth_errors,
)
async def api_trigger_generic(
    body: GenericTrigger,
    task_id: str | None = None,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await cicd_dispatch.trigger(db, body, task_id=task_id, actor=_build_actor(api_key))
