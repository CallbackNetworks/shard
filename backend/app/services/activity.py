from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import ActivityLog

# A ``share.viewed`` row names its subject in ``meta`` under a key that says which
# facade served the page: the identity facade writes ``identity_id``, the project
# facade ``project_id``, the generic node facade ``node_id`` (ADR-0016, ADR-0039).
# One node can have been viewed through more than one of them over its lifetime, so
# the count accepts all three and every surface reports the same number.
SHARE_VIEW_META_KEYS = ("identity_id", "project_id", "node_id")


def share_view_count(db: Session, entity_id: str) -> int:
    """How many times a shareable node's public page has been viewed."""
    return (
        db.query(ActivityLog.id)
        .filter(
            ActivityLog.action == "share.viewed",
            ActivityLog.meta.isnot(None),
            or_(*[ActivityLog.meta[key].as_string() == entity_id for key in SHARE_VIEW_META_KEYS]),
        )
        .count()
    )


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
