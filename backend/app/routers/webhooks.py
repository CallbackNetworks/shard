import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, Project
from app.schemas import WebhookCallback, TaskOut
from app.services.notifier import fire_notifications

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/callback/{callback_token}", response_model=TaskOut)
async def webhook_callback(
    callback_token: str,
    body: WebhookCallback,
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.callback_token == callback_token).first()
    if not task:
        raise HTTPException(status_code=404, detail="Invalid callback token")

    prev_status = task.status
    task.status = body.status
    db.commit()
    db.refresh(task)

    # Reload with project relationship
    task = (
        db.query(Task)
        .filter(Task.id == task.id)
        .first()
    )
    # Eagerly load project
    _ = task.project

    event = f"task.{body.status}"
    await fire_notifications(db, task, event)

    # If all tasks are done, also fire project.complete
    project: Project = task.project
    total = len(project.tasks)
    done = sum(1 for t in project.tasks if t.status == "done")
    if total > 0 and done == total:
        await fire_notifications(db, task, "project.complete")

    return task
