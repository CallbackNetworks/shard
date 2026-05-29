import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Task, TaskDependency
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.schemas import ReorderRequest, TaskCreate, TaskOut, TaskUpdate
from app.services.activity import log_activity
from app.services.rules_engine import run_rules
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: str,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    _get_project_or_404(project_id, db)
    q = db.query(Task).filter(Task.project_id == project_id)
    if status_filter:
        q = q.filter(Task.status == status_filter)
    return q.order_by(Task.position.asc(), Task.created_at.asc()).offset(offset).limit(limit).all()


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(project_id: str, body: TaskCreate, db: Session = Depends(get_db)):
    project = _get_project_or_404(project_id, db)
    task = Task(project_id=project_id, **body.model_dump())
    db.add(task)
    db.flush()
    log_activity(
        db,
        "task.created",
        project_id=project_id,
        task_id=task.id,
        actor=body.assignee,
        detail=f'Task "{task.title}" created in {project.name}',
        meta={"title": task.title, "priority": task.priority},
    )
    db.commit()
    db.refresh(task)
    await run_rules(db, "task.created", task, {})
    db.commit()
    db.refresh(task)
    await ws_manager.broadcast("task.created", {"project_id": project_id, "task_id": task.id})
    return task


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(project_id: str, task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    changes = body.model_dump(exclude_none=True)

    _validated_agent: ApiKey | None = None
    if "assigned_agent_key_id" in changes and changes["assigned_agent_key_id"] is not None:
        _validated_agent = db.query(ApiKey).filter(ApiKey.id == changes["assigned_agent_key_id"]).first()
        if not _validated_agent:
            raise HTTPException(status_code=400, detail="Agent API key not found")
        if not _validated_agent.active:
            raise HTTPException(status_code=400, detail="Agent API key is inactive")

    old_status = task.status
    old_priority = task.priority
    old_assignee = task.assignee
    old_agent_key_id = task.assigned_agent_key_id

    for field, value in changes.items():
        setattr(task, field, value)

    triggered_rules = []

    # Log status change
    if "status" in changes and changes["status"] != old_status:
        log_activity(
            db,
            "task.status_changed",
            project_id=project_id,
            task_id=task_id,
            actor=task.assignee,
            detail=f'Task "{task.title}" changed from {old_status} to {changes["status"]}',
            meta={"old_status": old_status, "new_status": changes["status"]},
        )
        triggered_rules.append(("task.status_changed", {"old_status": old_status}))

    # Log priority change
    if "priority" in changes and changes["priority"] != old_priority:
        triggered_rules.append(("task.priority_changed", {"old_priority": old_priority}))

    # Log assignee change
    if "assignee" in changes and changes["assignee"] != old_assignee:
        log_activity(
            db,
            "task.assigned",
            project_id=project_id,
            task_id=task_id,
            actor=changes["assignee"],
            detail=f'Task "{task.title}" assigned to {changes["assignee"] or "unassigned"}',
            meta={"old_assignee": old_assignee, "new_assignee": changes["assignee"]},
        )

    # Log agent assignment change
    if "assigned_agent_key_id" in changes and changes["assigned_agent_key_id"] != old_agent_key_id:
        agent_name = _validated_agent.name if _validated_agent else None
        log_activity(
            db,
            "task.agent_assigned",
            project_id=project_id,
            task_id=task_id,
            actor=agent_name or "system",
            detail=f'Task "{task.title}" agent assignment changed to {agent_name or "none"}',
            meta={"agent_name": agent_name},
        )

    db.commit()
    db.refresh(task)

    for trigger, ctx in triggered_rules:
        await run_rules(db, trigger, task, {"_rule_depth": 1, **ctx})
    if triggered_rules:
        db.commit()
        db.refresh(task)

    await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task_id})
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    log_activity(
        db,
        "task.deleted",
        project_id=project_id,
        task_id=task_id,
        actor=task.assignee,
        detail=f'Task "{task.title}" deleted',
        meta={"title": task.title},
    )
    db.delete(task)
    db.commit()
    await ws_manager.broadcast("task.deleted", {"project_id": project_id, "task_id": task_id})


@router.post("/{task_id}/dependencies/{depends_on_id}", status_code=status.HTTP_201_CREATED)
def add_dependency(project_id: str, task_id: str, depends_on_id: str, db: Session = Depends(get_db)):
    """Mark task_id as blocked by depends_on_id (depends_on must complete first)."""
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    blocker = db.query(Task).filter(Task.id == depends_on_id, Task.project_id == project_id).first()
    if not blocker:
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if task_id == depends_on_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    existing = (
        db.query(TaskDependency)
        .filter(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_id == depends_on_id,
        )
        .first()
    )
    if existing:
        return {"task_id": task_id, "depends_on_id": depends_on_id}
    dep = TaskDependency(task_id=task_id, depends_on_id=depends_on_id)
    db.add(dep)
    db.commit()
    return {"task_id": task_id, "depends_on_id": depends_on_id}


@router.delete("/{task_id}/dependencies/{depends_on_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_dependency(project_id: str, task_id: str, depends_on_id: str, db: Session = Depends(get_db)):
    """Remove the blocked-by dependency between task_id and depends_on_id."""
    _get_project_or_404(project_id, db)
    dep = (
        db.query(TaskDependency)
        .filter(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_id == depends_on_id,
        )
        .first()
    )
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(project_id: str, body: ReorderRequest, db: Session = Depends(get_db)):
    """Set the position of each task according to the given ordered list of IDs."""
    _get_project_or_404(project_id, db)
    for idx, task_id in enumerate(body.task_ids):
        db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).update({"position": idx})
    db.commit()
    await ws_manager.broadcast("task.reordered", {"project_id": project_id})


@router.post(
    "/{task_id}/regenerate-token",
    response_model=TaskOut,
    summary="Regenerate webhook callback token",
    description="Generates a new unique callback_token for a task. Old webhook URLs will stop working.",
)
def regenerate_token(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.callback_token = str(uuid.uuid4())
    log_activity(
        db,
        "task.token_regenerated",
        project_id=project_id,
        task_id=task_id,
        actor="system",
        detail=f'Webhook token regenerated for "{task.title}"',
        meta={"title": task.title},
    )
    db.commit()
    db.refresh(task)
    return task
