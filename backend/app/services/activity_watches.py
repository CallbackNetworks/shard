from sqlalchemy.orm import Session

from app.models import ActivityWatch, Node, NodeType
from app.services.errors import Invalid, NotFound

# A fixed, small qualitative palette distinct from the status/priority/accent
# families (ADR-0088 reserves those meanings) — assigned round-robin by creation
# order rather than user-picked, so registering a curve stays a one-click act.
_PALETTE = ["#38bdf8", "#a78bfa", "#fb7185", "#2dd4bf", "#f472b6", "#84cc16"]


def _next_color(db: Session) -> str:
    count = db.query(ActivityWatch.id).count()
    return _PALETTE[count % len(_PALETTE)]


def list_watches(db: Session) -> list[ActivityWatch]:
    return db.query(ActivityWatch).order_by(ActivityWatch.created_at.asc()).all()


def create_watch(
    db: Session,
    *,
    kind: str,
    target_id: str | None = None,
    target_type: str | None = None,
    label: str | None = None,
) -> ActivityWatch:
    if kind not in ("node", "node_type"):
        raise Invalid(f"kind must be 'node' or 'node_type', got '{kind}'")

    if kind == "node":
        if not target_id:
            raise Invalid("target_id is required for kind='node'")
        node = db.get(Node, target_id)
        if node is None:
            raise NotFound(f"node {target_id} not found")
        resolved_label = label or node.title or target_id[-8:]
        target_type = None
    else:
        if not target_type:
            raise Invalid("target_type is required for kind='node_type'")
        node_type = db.get(NodeType, target_type)
        if node_type is None:
            raise NotFound(f"node type '{target_type}' not found")
        resolved_label = label or node_type.label
        target_id = None

    watch = ActivityWatch(
        kind=kind,
        target_id=target_id,
        target_type=target_type,
        label=resolved_label,
        color=_next_color(db),
    )
    db.add(watch)
    db.commit()
    db.refresh(watch)
    return watch


def delete_watch(db: Session, watch_id: str) -> None:
    watch = db.get(ActivityWatch, watch_id)
    if watch is None:
        raise NotFound(f"watch {watch_id} not found")
    db.delete(watch)
    db.commit()
