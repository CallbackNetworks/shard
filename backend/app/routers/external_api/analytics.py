"""
External API v1 — Analytics endpoints.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _project_ids_in_scope,
    _require_scope,
    _resolve_project_scope,
)
from app.services import analytics_admin

sub_router = APIRouter()


@sub_router.get(
    "/analytics/overview",
    summary="Platform analytics overview",
    description="""Platform-wide aggregated statistics: task counts by status, overdue/failed/high-priority-active counts, most active project last 7 days.

If the API key is scoped to a single project, counts are restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_overview(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return analytics_admin.overview(db, project_ids=_project_ids_in_scope(db, api_key))


@sub_router.get(
    "/analytics/heatmap",
    summary="Activity heatmap data",
    description="""Daily activity counts for the last year (or a custom date range). Useful for visualizing work cadence.

Pass `start` and `end` as `YYYY-MM-DD`. Optionally filter by `project_id`. If the API key is project-scoped, data is restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_heatmap(
    start: str | None = Query(None, description="Start date YYYY-MM-DD (default: 1 year ago)"),
    end: str | None = Query(None, description="End date YYYY-MM-DD (default: today)"),
    project_id: str | None = Query(None, description="Filter by project"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    return analytics_admin.heatmap(
        db,
        start=datetime.fromisoformat(start) if start else None,
        end=datetime.fromisoformat(end) if end else None,
        project_ids=scoped_project_ids if scoped_project_ids is not None else ([project_id] if project_id else None),
    )


@sub_router.get(
    "/analytics/status-trend",
    summary="Task status trend over time",
    description="""Daily snapshot of task counts by status (todo, in_progress, done, failed) over the last N days.

Useful for agents tracking project momentum and detecting stalls. Optionally filter by `project_id`. If the API key is project-scoped, data is restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_status_trend(
    project_id: str | None = Query(None, description="Filter by project"),
    days: int = Query(30, ge=1, le=365, description="Number of days to include"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    scoped_project_ids = _project_ids_in_scope(db, api_key)
    return analytics_admin.status_trend(
        db,
        days=days,
        project_ids=scoped_project_ids if scoped_project_ids is not None else ([project_id] if project_id else None),
    )


@sub_router.get(
    "/analytics/velocity",
    summary="Sprint velocity per completed cycle",
    description="""Returns completed tasks per cycle for a project, useful for measuring team/agent velocity across sprints.

Requires a `project_id` query parameter. Requires `read` scope.""",
    responses={**_auth_errors, 400: {"description": "project_id is required for non-scoped keys"}},
)
def api_analytics_velocity(
    project_id: str | None = Query(None, description="Project to analyze (required unless the key is project-scoped)"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    pid = _resolve_project_scope(db, api_key, project_id, required=True)
    return analytics_admin.velocity(db, pid)


# ── Planning analytics (ADR-0086) ────────────────────────────────────
#
# v1 had the retrospective half — overview, heatmap, velocity, status-trend. This is the
# half that answers "what should I do next", which is the half an agent planning work
# actually needs. Shared with the internal door through `services/analytics_admin`.


@sub_router.get(
    "/analytics/critical-path/{project_id}",
    summary="The critical path through a project",
    description=(
        "The longest chain of `depends_on` edges — the tasks that actually gate the end "
        "date, as opposed to the ones that merely look urgent. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_critical_path(project_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return analytics_admin.critical_path(db, project_id)


@sub_router.get(
    "/analytics/burndown",
    summary="Daily burn-down for a cycle",
    description="Remaining and done per day across the cycle's window. Requires `read` scope.",
    responses=_auth_errors,
)
def api_burndown(cycle_id: str = Query(...), db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return analytics_admin.burndown(db, cycle_id)


@sub_router.get(
    "/analytics/cycle-burndown",
    summary="Burn-down for a cycle, with the ideal line",
    description="As `burndown`, plus the straight-line ideal to compare against. Requires `read` scope.",
    responses=_auth_errors,
)
def api_cycle_burndown(
    cycle_id: str = Query(...), db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "read")
    return analytics_admin.cycle_burndown(db, cycle_id)


@sub_router.get(
    "/analytics/estimation-calibration",
    summary="How well estimates have matched reality",
    description=(
        "Spent-versus-estimate on completed tasks, overall and grouped by estimate size, so "
        "systematic under- or over-estimation becomes visible. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_estimation_calibration(
    project_id: str | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    pid = _resolve_project_scope(db, api_key, project_id)
    return analytics_admin.estimation_calibration(db, pid, limit)


@sub_router.get(
    "/analytics/estimate-suggestion",
    summary="Calibrate an estimate against past history",
    description=(
        "Applies the historical spent/estimate ratio for tasks of a similar size to the raw "
        "estimate you pass in. Returns `suggested_estimate: null` with a reason when there "
        "is not enough history — a number invented from three samples is worse than no "
        "number. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_estimate_suggestion(
    raw_estimate: int = Query(..., ge=1, description="Your raw estimate, in minutes"),
    project_id: str | None = Query(None),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    pid = _resolve_project_scope(db, api_key, project_id)
    return analytics_admin.estimate_suggestion(db, raw_estimate, pid)
