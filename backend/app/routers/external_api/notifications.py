"""
External API v1 — Notification endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Notification
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import NotificationOut

sub_router = APIRouter()


@sub_router.get(
    "/notifications",
    summary="List in-app notifications",
    description="Returns recent in-app notifications. Pass `unread_only=true` to retrieve only unread ones. Requires `read` scope.",
    response_model=list[NotificationOut],
    responses=_auth_errors,
)
def api_list_notifications(
    unread_only: bool = Query(False, description="Return only unread notifications"),
    limit: int = Query(50, ge=1, le=200, description="Max notifications to return"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    q = db.query(Notification)
    if unread_only:
        q = q.filter(Notification.read == False)  # noqa: E712
    return q.order_by(Notification.created_at.desc()).limit(limit).all()


@sub_router.get(
    "/notifications/unread-count",
    summary="Get unread notification count",
    description="Returns the number of unread in-app notifications. Useful for agents to poll for new events. Requires `read` scope.",
    responses=_auth_errors,
)
def api_notifications_unread_count(
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    count = db.query(Notification).filter(Notification.read == False).count()  # noqa: E712
    return {"count": count}


@sub_router.patch(
    "/notifications/{notification_id}/read",
    summary="Mark a notification as read",
    description="Marks a single notification as read. Requires `write` scope.",
    response_model=NotificationOut,
    responses={**_auth_errors, 404: {"description": "Notification not found"}},
)
def api_mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    db.commit()
    db.refresh(notif)
    return notif
