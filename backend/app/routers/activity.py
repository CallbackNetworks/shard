from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog, Node
from app.schemas import ActivityLogOut

router = APIRouter(prefix="/activity", tags=["activity"])


def _with_node_type(db: Session, entries: list[ActivityLog]) -> list[ActivityLogOut]:
    """Resolve each entry's subject node's current type (ADR-0105).

    Not stored on the row: ``task_id`` (tasks) or ``meta.node_id`` (every other type,
    set by ``_generic_scope`` in graph_dispatch.py) already names the subject, so one
    batched lookup against the live ``nodes`` table is enough — no migration, and a
    type change is reflected instead of frozen at log time.
    """
    ids: set[str] = set()
    for e in entries:
        subject = e.task_id or (e.meta or {}).get("node_id")
        if subject:
            ids.add(subject)
    types = dict(db.query(Node.id, Node.type).filter(Node.id.in_(ids)).all()) if ids else {}

    out = []
    for e in entries:
        subject = e.task_id or (e.meta or {}).get("node_id")
        out.append(
            ActivityLogOut.model_validate(e, from_attributes=True).model_copy(update={"node_type": types.get(subject)})
        )
    return out


@router.get("", response_model=list[ActivityLogOut])
def list_activity(
    project_id: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(ActivityLog)
    if project_id:
        query = query.filter(ActivityLog.project_id == project_id)
    entries = query.order_by(ActivityLog.created_at.desc()).offset(offset).limit(limit).all()
    return _with_node_type(db, entries)
