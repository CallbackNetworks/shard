from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import analytics_admin
from app.services.usage_tracker import tracker

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)):
    return analytics_admin.overview(db)


@router.get("/heatmap")
def get_heatmap(
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    project_id: str | None = None,
    db: Session = Depends(get_db),
):
    return analytics_admin.heatmap(
        db,
        start=datetime.fromisoformat(start) if start else None,
        end=datetime.fromisoformat(end) if end else None,
        project_ids=[project_id] if project_id else None,
    )


@router.get("/burndown")
def get_burndown(cycle_id: str, db: Session = Depends(get_db)):
    return analytics_admin.burndown(db, cycle_id)


@router.get("/velocity")
def get_velocity(project_id: str, db: Session = Depends(get_db)):
    return analytics_admin.velocity(db, project_id)


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
    return analytics_admin.status_trend(db, days=days, project_ids=[project_id] if project_id else None)
