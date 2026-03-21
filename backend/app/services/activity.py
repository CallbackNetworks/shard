from sqlalchemy.orm import Session
from app.models import ActivityLog


def log_activity(
    db: Session,
    action: str,
    *,
    project_id: str | None = None,
    task_id: str | None = None,
    actor: str | None = None,
    detail: str | None = None,
    meta: dict | None = None,
) -> ActivityLog:
    entry = ActivityLog(
        project_id=project_id,
        task_id=task_id,
        action=action,
        actor=actor,
        detail=detail,
        meta=meta,
    )
    db.add(entry)
    db.flush()
    return entry
