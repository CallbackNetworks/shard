from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, Node
from app.services import graph
from app.services.critical_path import compute_critical_path
from app.services.usage_tracker import tracker

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)

    def _task_count():
        return db.query(func.count(Node.id)).filter(Node.type == graph.NODE_TASK)

    total_tasks = _task_count().scalar() or 0
    done_tasks = _task_count().filter(Node.status == "done").scalar() or 0
    in_progress = _task_count().filter(Node.status == "in_progress").scalar() or 0
    overdue = _task_count().filter(Node.due_date < now, Node.status.notin_(["done", "failed"])).scalar() or 0

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
    cycle = graph.get_cycle(db, cycle_id)
    if not cycle:
        return []

    start = cycle.start_date or cycle.created_at
    end = cycle.end_date or datetime.now(UTC)
    if not start:
        return []

    # Total tasks in cycle
    task_ids = graph.task_ids_in_cycle(db, cycle_id)
    if not task_ids:
        return []

    total = len(task_ids)
    result = []
    current = start
    while current <= end:
        day_end = current.replace(hour=23, minute=59, second=59)
        done_count = (
            db.query(func.count(Node.id))
            .filter(
                Node.type == graph.NODE_TASK,
                Node.id.in_(task_ids),
                Node.status == "done",
                Node.updated_at <= day_end,
            )
            .scalar()
            or 0
        )
        result.append(
            {
                "date": current.strftime("%Y-%m-%d"),
                "remaining": total - done_count,
                "done": done_count,
            }
        )
        current += timedelta(days=1)
        if len(result) > 365:
            break

    return result


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
def get_cycle_burndown(
    cycle_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Burn-down chart data for a cycle: daily remaining tasks."""
    cycle = graph.get_cycle(db, cycle_id)
    if not cycle:
        return []

    cycle_task_ids = graph.task_ids_in_cycle(db, cycle.id)
    if not cycle_task_ids:
        return []

    tasks = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.id.in_(cycle_task_ids)).all()
    total = len(tasks)

    start = cycle.start_date or min((t.created_at for t in tasks), default=datetime.now(UTC))
    end = cycle.end_date or datetime.now(UTC)

    # Build daily burndown
    result = []
    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = end.replace(hour=23, minute=59, second=59)
    today = datetime.now(UTC)
    if end_day > today:
        end_day = today

    while current <= end_day:
        day_end = current.replace(hour=23, minute=59, second=59)
        # Count tasks completed by this day
        done_by_day = sum(1 for t in tasks if t.status == "done" and t.updated_at and t.updated_at <= day_end)
        remaining = total - done_by_day
        result.append(
            {
                "date": current.strftime("%Y-%m-%d"),
                "remaining": remaining,
                "total": total,
                "done": done_by_day,
            }
        )
        current += timedelta(days=1)

    # Add ideal burndown line
    if len(result) > 1:
        for i, point in enumerate(result):
            point["ideal"] = round(total - (total * i / (len(result) - 1)), 1)

    return result


@router.get("/critical-path/{project_id}")
def get_critical_path(project_id: str, db: Session = Depends(get_db)):
    """Compute the critical path through task dependencies for a project."""
    return compute_critical_path(db, project_id)


@router.get("/usage")
def get_usage():
    """Route-level request stats (in-memory, resets on restart)."""
    return tracker.snapshot()


@router.delete("/usage")
def reset_usage():
    """Clear all usage stats."""
    tracker.reset()
    return {"status": "cleared"}


ESTIMATE_BUCKETS = [
    ("<=30m", 0, 30),
    ("31-60m", 31, 60),
    ("1-2h", 61, 120),
    ("2-4h", 121, 240),
    (">4h", 241, None),
]


@router.get("/estimation-calibration")
def get_estimation_calibration(
    project_id: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Compare time_estimate vs time_spent on completed tasks.

    Returns overall calibration (spent/estimate ratio) plus accuracy grouped
    by estimate size, so systematic under/over-estimation becomes visible.
    """
    # time_estimate/time_spent live in node.data (JSON); filter them in Python
    # after the hot-column query for dialect-safety (ADR-0033, node-only tasks).
    q = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.status == "done")
    if project_id:
        q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
    tasks = [
        v
        for v in (graph.task_view(n, db) for n in q.order_by(Node.updated_at.desc()).all())
        if v.time_estimate and v.time_estimate > 0 and v.time_spent and v.time_spent > 0
    ][:limit]

    if not tasks:
        return {
            "sample_size": 0,
            "overall_ratio": None,
            "median_ratio": None,
            "within_20_pct": None,
            "underestimated": 0,
            "overestimated": 0,
            "buckets": [],
            "recent_tasks": [],
        }

    ratios = sorted(t.time_spent / t.time_estimate for t in tasks)
    n = len(ratios)
    median_ratio = ratios[n // 2] if n % 2 == 1 else (ratios[n // 2 - 1] + ratios[n // 2]) / 2
    total_estimate = sum(t.time_estimate for t in tasks)
    total_spent = sum(t.time_spent for t in tasks)
    within = sum(1 for r in ratios if 0.8 <= r <= 1.2)

    buckets = []
    for label, low, high in ESTIMATE_BUCKETS:
        bucket_tasks = [t for t in tasks if t.time_estimate >= low and (high is None or t.time_estimate <= high)]
        if not bucket_tasks:
            buckets.append({"label": label, "count": 0, "avg_ratio": None})
            continue
        bucket_ratio = sum(t.time_spent for t in bucket_tasks) / sum(t.time_estimate for t in bucket_tasks)
        buckets.append({"label": label, "count": len(bucket_tasks), "avg_ratio": round(bucket_ratio, 2)})

    recent_projects = graph.project_ids_map(db, [t.id for t in tasks[:20]])
    recent = [
        {
            "id": t.id,
            "title": t.title,
            "project_id": next(iter(recent_projects.get(t.id, [])), None),
            "time_estimate": t.time_estimate,
            "time_spent": t.time_spent,
            "ratio": round(t.time_spent / t.time_estimate, 2),
        }
        for t in tasks[:20]
    ]

    return {
        "sample_size": n,
        "overall_ratio": round(total_spent / total_estimate, 2),
        "median_ratio": round(median_ratio, 2),
        "within_20_pct": round(within / n * 100),
        "underestimated": sum(1 for r in ratios if r > 1.2),
        "overestimated": sum(1 for r in ratios if r < 0.8),
        "buckets": buckets,
        "recent_tasks": recent,
    }


# Minimum completed samples before a calibration suggestion is offered at all,
# and the minimum in a specific size bucket before we trust that bucket's ratio
# over the overall median.
_MIN_CALIBRATION_SAMPLE = 5
_MIN_BUCKET_SAMPLE = 3


@router.get("/estimate-suggestion")
def get_estimate_suggestion(
    raw_estimate: int = Query(..., ge=1, description="The user's raw estimate in minutes"),
    project_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Suggest a calibrated estimate from the user's own history (closes the loop).

    Given a raw estimate, apply the historical spent/estimate ratio for tasks of
    a similar size (or the overall median when that size bucket is sparse). Falls
    back to global history when a project has too few completed, estimated tasks.
    Returns suggested=None with a reason when there is not enough signal.
    """

    def _completed(scoped_project: str | None):
        q = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.status == "done")
        if scoped_project:
            q = q.filter(Node.id.in_(graph.contained_task_ids(db, scoped_project)))
        return [
            v
            for v in (graph.task_view(n, db) for n in q.order_by(Node.updated_at.desc()).all())
            if v.time_estimate and v.time_estimate > 0 and v.time_spent and v.time_spent > 0
        ][:2000]

    tasks = _completed(project_id)
    basis_scope = "project"
    if project_id and len(tasks) < _MIN_CALIBRATION_SAMPLE:
        tasks = _completed(None)
        basis_scope = "global"

    if len(tasks) < _MIN_CALIBRATION_SAMPLE:
        return {
            "raw_estimate": raw_estimate,
            "suggested_estimate": None,
            "reason": "not_enough_history",
            "sample_size": len(tasks),
        }

    # Prefer the ratio of the size bucket the raw estimate falls into.
    bucket_label = next(
        (
            label
            for label, low, high in ESTIMATE_BUCKETS
            if raw_estimate >= low and (high is None or raw_estimate <= high)
        ),
        None,
    )
    bucket_tasks = []
    for label, low, high in ESTIMATE_BUCKETS:
        if label == bucket_label:
            bucket_tasks = [t for t in tasks if t.time_estimate >= low and (high is None or t.time_estimate <= high)]
            break

    if len(bucket_tasks) >= _MIN_BUCKET_SAMPLE:
        ratio = sum(t.time_spent for t in bucket_tasks) / sum(t.time_estimate for t in bucket_tasks)
        basis = "bucket"
        sample = len(bucket_tasks)
    else:
        ratios = sorted(t.time_spent / t.time_estimate for t in tasks)
        n = len(ratios)
        ratio = ratios[n // 2] if n % 2 == 1 else (ratios[n // 2 - 1] + ratios[n // 2]) / 2
        basis = "overall_median"
        sample = n

    suggested = max(1, round(raw_estimate * ratio))
    return {
        "raw_estimate": raw_estimate,
        "suggested_estimate": suggested,
        "ratio": round(ratio, 2),
        "basis": basis,
        "basis_scope": basis_scope,
        "bucket": bucket_label,
        "sample_size": sample,
    }


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
        q = db.query(Node.status, func.count(Node.id)).filter(Node.type == graph.NODE_TASK, Node.created_at <= day)
        if project_id:
            q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
        rows = q.group_by(Node.status).all()
        entry = {"date": day.strftime("%Y-%m-%d"), "todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        for status, count in rows:
            if status in entry:
                entry[status] = count
        result.append(entry)
    return result
