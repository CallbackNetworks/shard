from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog
from app.schemas import ActivityLogOut

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("", response_model=list[ActivityLogOut])
def list_activity(
    project_id: str | None = None,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(ActivityLog)
    if project_id:
        query = query.filter(ActivityLog.project_id == project_id)
    return query.order_by(ActivityLog.created_at.desc()).limit(limit).all()
