from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, Node
from app.services import analytics_admin, graph
from app.services.usage_tracker import tracker

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)

    def _task_count():
        return db.query(func.count(Node.id)).filter(graph.task_type_filter(db))

    total_tasks = _task_count().scalar() or 0
    done_tasks = _task_count().filter(Node.status == "done").scalar() or 0
    in_progress = _task_count().filter(Node.status == "in_progress").scalar() or 0
    overdue = _task_count().filter(*graph.overdue_clause(now)).scalar() or 0

    # Most active project last 7 days
    activity_counts = (
        db.query(ActivityLog.project_id, func.count(ActivityLog.id).label("cnt"))
        .filter(ActivityLog.created_at >= week_ago, ActivityLog.project_id != None)
        .group_by(ActivityLog.project_id)
        .order_by(func.count(ActivityLog.id).desc())
        .first()
    )
    most_active_project = None
    if activity_counts:
        p = graph.get_project(db, activity_counts.project_id)
        if p:
            most_active_project = {"id": p.id, "name": p.name, "activity_count": activity_counts.cnt}

    def _project_count():
        return db.query(func.count(Node.id)).filter(Node.type == graph.NODE_PROJECT)

    total_projects = _project_count().scalar() or 0
    active_projects = _project_count().filter(Node.status == "active").scalar() or 0

    return {
        "total_projects": total_projects,
        "active_projects": active_projects,
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "in_progress_tasks": in_progress,
        "overdue_tasks": overdue,
        "most_active_project": most_active_project,
    }


@router.get("/heatmap")
def get_heatmap(
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    project_id: str | None = None,
    db: Session = Depends(get_db),
):
    now = datetime.now(UTC)
    end_dt = datetime.fromisoformat(end) if end else now
    start_dt = datetime.fromisoformat(start) if start else end_dt - timedelta(days=365)

    day_col = func.date(ActivityLog.created_at).label("day")
    q = db.query(day_col, func.count(ActivityLog.id).label("count")).filter(
        ActivityLog.created_at >= start_dt,
        ActivityLog.created_at <= end_dt,
    )
    if project_id:
        q = q.filter(ActivityLog.project_id == project_id)
    rows = q.group_by(day_col).order_by(day_col).all()
    return [{"date": str(r.day), "count": r.count} for r in rows]


@router.get("/burndown")
def get_burndown(cycle_id: str, db: Session = Depends(get_db)):
    return analytics_admin.burndown(db, cycle_id)


@router.get("/velocity")
def get_velocity(project_id: str, db: Session = Depends(get_db)):
    cycles = [c for c in graph.cycles_in_project(db, project_id) if c.status == "completed"]
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


@router.get("/cycle-burndown")
def get_cycle_burndown(cycle_id: str = Query(...), db: Session = Depends(get_db)):
    """Burn-down chart data for a cycle: daily remaining tasks."""
    return analytics_admin.cycle_burndown(db, cycle_id)


@router.get("/critical-path/{project_id}")
def get_critical_path(project_id: str, db: Session = Depends(get_db)):
    """Compute the critical path through task dependencies for a project."""
    return analytics_admin.critical_path(db, project_id)


@router.get("/usage")
def get_usage():
    """Route-level request stats (in-memory, resets on restart)."""
    return tracker.snapshot()


@router.delete("/usage")
def reset_usage():
    """Clear all usage stats."""
    tracker.reset()
    return {"status": "cleared"}


@router.get("/estimation-calibration")
def get_estimation_calibration(
    project_id: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Compare time_estimate vs time_spent on completed tasks."""
    return analytics_admin.estimation_calibration(db, project_id, limit)


@router.get("/estimate-suggestion")
def get_estimate_suggestion(
    raw_estimate: int = Query(..., ge=1, description="The user's raw estimate in minutes"),
    project_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Suggest a calibrated estimate from the user's own history (closes the loop)."""
    return analytics_admin.estimate_suggestion(db, raw_estimate, project_id)


@router.get("/status-trend")
def get_status_trend(
    project_id: str | None = None,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    now = datetime.now(UTC)
    result = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=23, minute=59, second=59)
        q = db.query(Node.status, func.count(Node.id)).filter(graph.task_type_filter(db), Node.created_at <= day)
        if project_id:
            q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
        rows = q.group_by(Node.status).all()
        entry = {"date": day.strftime("%Y-%m-%d"), "todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        for status, count in rows:
            if status in entry:
                entry[status] = count
        result.append(entry)
    return result
