from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, Cycle, CycleTask, Project, Task
from app.services.usage_tracker import tracker

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)

    total_tasks = db.query(func.count(Task.id)).scalar() or 0
    done_tasks = db.query(func.count(Task.id)).filter(Task.status == "done").scalar() or 0
    in_progress = db.query(func.count(Task.id)).filter(Task.status == "in_progress").scalar() or 0
    overdue = (
        db.query(func.count(Task.id)).filter(Task.due_date < now, Task.status.notin_(["done", "failed"])).scalar() or 0
    )

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
        p = db.query(Project).filter(Project.id == activity_counts.project_id).first()
        if p:
            most_active_project = {"id": p.id, "name": p.name, "activity_count": activity_counts.cnt}

    total_projects = db.query(func.count(Project.id)).scalar() or 0
    active_projects = db.query(func.count(Project.id)).filter(Project.status == "active").scalar() or 0

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
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id).first()
    if not cycle:
        return []

    start = cycle.start_date or cycle.created_at
    end = cycle.end_date or datetime.now(UTC)
    if not start:
        return []

    # Total tasks in cycle
    task_ids = [ct.task_id for ct in db.query(CycleTask).filter(CycleTask.cycle_id == cycle_id).all()]
    if not task_ids:
        return []

    total = len(task_ids)
    result = []
    current = start
    while current <= end:
        day_end = current.replace(hour=23, minute=59, second=59)
        done_count = (
            db.query(func.count(Task.id))
            .filter(Task.id.in_(task_ids), Task.status == "done", Task.updated_at <= day_end)
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
    cycles = (
        db.query(Cycle)
        .filter(
            Cycle.project_id == project_id,
            Cycle.status == "completed",
        )
        .order_by(Cycle.start_date)
        .all()
    )

    result = []
    for cycle in cycles:
        task_ids = [ct.task_id for ct in cycle.cycle_tasks]
        done_count = sum(1 for ct in cycle.cycle_tasks if ct.task and ct.task.status == "done")
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
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id).first()
    if not cycle:
        return []

    cycle_task_ids = [ct.task_id for ct in cycle.cycle_tasks]
    if not cycle_task_ids:
        return []

    tasks = db.query(Task).filter(Task.id.in_(cycle_task_ids)).all()
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


@router.get("/usage")
def get_usage():
    """Route-level request stats (in-memory, resets on restart)."""
    return tracker.snapshot()


@router.delete("/usage")
def reset_usage():
    """Clear all usage stats."""
    tracker.reset()
    return {"status": "cleared"}


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
        q = db.query(Task.status, func.count(Task.id)).filter(Task.created_at <= day)
        if project_id:
            q = q.filter(Task.project_id == project_id)
        rows = q.group_by(Task.status).all()
        entry = {"date": day.strftime("%Y-%m-%d"), "todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        for status, count in rows:
            if status in entry:
                entry[status] = count
        result.append(entry)
    return result
