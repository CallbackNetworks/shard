"""
External API v1 — Analytics endpoints.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, ApiKey, Node
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.services import analytics_admin, graph

sub_router = APIRouter()


@sub_router.get(
    "/analytics/overview",
    summary="Platform analytics overview",
    description="""Platform-wide aggregated statistics: task counts by status, overdue count, most active project last 7 days.

If the API key is scoped to a single project, counts are restricted to that project. Requires `read` scope.""",
    responses=_auth_errors,
)
def api_analytics_overview(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    pid = api_key.project_id  # None means platform-wide
    pid_task_ids = graph.contained_task_ids(db, pid) if pid else None

    def _task_count(*filters):
        q = db.query(func.count(Node.id)).filter(graph.task_type_filter(db))
        if pid:
            q = q.filter(Node.id.in_(pid_task_ids))
        return (q.filter(*filters).scalar() or 0) if filters else (q.scalar() or 0)

    total_tasks = _task_count()
    done_tasks = _task_count(Node.status == "done")
    in_progress = _task_count(Node.status == "in_progress")
    overdue = _task_count(*graph.overdue_clause(now))

    proj_q = db.query(func.count(Node.id)).filter(Node.type == graph.NODE_PROJECT)
    if pid:
        proj_q = proj_q.filter(Node.id == pid)
    total_projects = proj_q.scalar() or 0
    active_projects = proj_q.filter(Node.status == "active").scalar() or 0

    act_q = db.query(ActivityLog.project_id, func.count(ActivityLog.id).label("cnt")).filter(
        ActivityLog.created_at >= week_ago, ActivityLog.project_id.isnot(None)
    )
    if pid:
        act_q = act_q.filter(ActivityLog.project_id == pid)
    top_activity = act_q.group_by(ActivityLog.project_id).order_by(func.count(ActivityLog.id).desc()).first()
    most_active_project = None
    if top_activity:
        p = graph.get_project(db, top_activity.project_id)
        if p:
            most_active_project = {"id": p.id, "name": p.name, "activity_count": top_activity.cnt}

    return {
        "total_projects": total_projects,
        "active_projects": active_projects,
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "in_progress_tasks": in_progress,
        "overdue_tasks": overdue,
        "most_active_project": most_active_project,
    }


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
    if api_key.project_id:
        project_id = api_key.project_id
    now = datetime.now(UTC)
    end_dt = datetime.fromisoformat(end) if end else now
    start_dt = datetime.fromisoformat(start) if start else end_dt - timedelta(days=365)

    day_col = func.date(ActivityLog.created_at).label("day")
    q = db.query(
        day_col,
        func.count(ActivityLog.id).label("count"),
    ).filter(ActivityLog.created_at >= start_dt, ActivityLog.created_at <= end_dt)
    if project_id:
        q = q.filter(ActivityLog.project_id == project_id)
    rows = q.group_by(day_col).order_by(day_col).all()
    return [{"date": str(r.day), "count": r.count} for r in rows]


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
    if api_key.project_id:
        project_id = api_key.project_id
    now = datetime.now(UTC)
    result = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=23, minute=59, second=59)
        q = db.query(Node.status, func.count(Node.id)).filter(graph.task_type_filter(db), Node.created_at <= day)
        if project_id:
            q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
        rows = q.group_by(Node.status).all()
        entry = {"date": day.strftime("%Y-%m-%d"), "todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        for s, count in rows:
            if s in entry:
                entry[s] = count
        result.append(entry)
    return result


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
    pid = api_key.project_id or project_id
    if not pid:
        raise HTTPException(status_code=400, detail="project_id is required")
    _check_project_access(api_key, pid)
    cycles = [c for c in graph.cycles_in_project(db, pid) if c.status == "completed"]
    cycles.sort(key=lambda c: (c.start_date is None, c.start_date))
    result = []
    for cycle in cycles:
        c_tasks = graph.tasks_in_cycle(db, cycle.id)
        task_ids = [t.id for t in c_tasks]
        done_count = sum(1 for t in c_tasks if t.status == "done")
        result.append(
            {
                "cycle_id": cycle.id,
                "name": cycle.name,
                "total_tasks": len(task_ids),
                "completed_tasks": done_count,
                "start_date": cycle.start_date.isoformat() if cycle.start_date else None,
                "end_date": cycle.end_date.isoformat() if cycle.end_date else None,
            }
        )
    return result


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
    _check_project_access(api_key, project_id)
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
    return analytics_admin.estimation_calibration(db, project_id or api_key.project_id, limit)


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
    return analytics_admin.estimate_suggestion(db, raw_estimate, project_id or api_key.project_id)
