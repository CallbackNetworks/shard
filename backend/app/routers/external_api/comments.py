"""
External API v1 — Comment CRUD endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Comment
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.routers.external_api.helpers import _get_task_or_404
from app.schemas import CommentCreate, CommentOut, CommentUpdate
from app.services.activity import log_activity
from app.services.notifier import fire_notifications
from app.services.ws_manager import ws_manager

sub_router = APIRouter()


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}/comments",
    summary="List comments on a task",
    description="Returns all comments on a task in chronological order. Agent-posted comments are attributed via the `author` field. Requires `read` scope.",
    response_model=list[CommentOut],
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
def api_list_comments(
    project_id: str,
    task_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    return db.query(Comment).filter(Comment.task_id == task_id).order_by(Comment.created_at.asc()).all()


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/comments",
    status_code=status.HTTP_201_CREATED,
    summary="Add a comment to a task",
    description="""Posts a comment on a task. If `author` is omitted, it defaults to the API key name (e.g. `api:my-agent`), making agent comments easily identifiable.

Useful for agent-to-human and agent-to-agent communication within a task thread. Requires `write` scope.""",
    response_model=CommentOut,
    responses={**_auth_errors, 404: {"description": "Task not found"}},
)
async def api_create_comment(
    project_id: str,
    task_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    task = _get_task_or_404(project_id, task_id, db)

    data = body.model_dump()
    if not data.get("author"):
        data["author"] = f"api:{api_key.name}"

    comment = Comment(task_id=task_id, project_id=project_id, **data)
    db.add(comment)
    db.flush()
    log_activity(
        db,
        "comment.created",
        project_id=project_id,
        task_id=task_id,
        actor=f"api:{api_key.name}",
        detail=f"Comment added via API by {data['author']}",
        meta={"api_key": api_key.name},
    )
    db.commit()
    db.refresh(comment)
    await fire_notifications(db, task, "comment.created", source="api", actor=f"api:{api_key.name}")
    await ws_manager.broadcast("comment.created", {"project_id": project_id, "task_id": task_id})
    return comment


@sub_router.patch(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}",
    summary="Edit a comment",
    description="Updates the body of an existing comment. Requires `write` scope.",
    response_model=CommentOut,
    responses={**_auth_errors, 404: {"description": "Comment not found"}},
)
def api_update_comment(
    project_id: str,
    task_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.body = body.body
    db.commit()
    db.refresh(comment)
    return comment


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a comment",
    description="Permanently deletes a comment. Requires `write` scope.",
    responses={**_auth_errors, 404: {"description": "Comment not found"}},
)
def api_delete_comment(
    project_id: str,
    task_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    _get_task_or_404(project_id, task_id, db)
    comment = db.query(Comment).filter(Comment.id == comment_id, Comment.task_id == task_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    db.delete(comment)
    db.commit()
