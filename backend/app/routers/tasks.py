import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Node
from app.routers.deps import get_parent_task_or_error, get_task_or_404
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.routers.issue_sync import (
    create_external_issue_from_task,
    sync_task_closure_to_external,
    sync_task_fields_to_external,
    sync_task_reopen_to_external,
)
from app.schemas import ReorderRequest, TaskCreate, TaskOut, TaskUpdate, TaskWithSubtasksOut
from app.services import graph
from app.services.activity import log_activity
from app.services.enrichment import enrich_task
from app.services.notifier import fire_notifications
from app.services.rules_engine import run_rules
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["tasks"])


@router.get("")
def list_tasks(
    project_id: str,
    status_filter: str | None = Query(None, alias="status"),
    include: str | None = Query(None, description="Comma-separated includes: subtasks"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    _get_project_or_404(project_id, db)
    # contained_task_ids already role-filters (built-in task + user-defined task-like, ADR-0035).
    q = db.query(Node).filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
    if status_filter:
        q = q.filter(Node.status == status_filter)
    want_subtasks = include and "subtasks" in include.split(",")
    nodes = q.order_by(Node.position.asc(), Node.created_at.asc()).offset(offset).limit(limit).all()
    tasks = [graph.task_view(n, db) for n in nodes]

    def _to_out(t, proj_map, par_map, cont_map):
        out = TaskOut.model_validate(t, from_attributes=True)
        out.project_ids = proj_map.get(t.id, [])
        out.project_id = out.project_ids[0] if out.project_ids else None
        out.container_ids = cont_map.get(t.id, [])
        out.parent_id = par_map.get(t.id)
        return out

    if not want_subtasks:
        ids = [t.id for t in tasks]
        proj_map = graph.project_ids_map(db, ids)
        cont_map = graph.container_ids_map(db, ids)
        par_map = graph.parent_task_map(db, ids)
        return [_to_out(t, proj_map, par_map, cont_map).model_dump() for t in tasks]

    # Nest subtasks from task->task contains edges (ADR-0032).
    children_map = graph.child_task_ids_map(db, [t.id for t in tasks])
    child_ids = {cid for lst in children_map.values() for cid in lst}
    child_by_id = graph.task_views_by_ids(db, child_ids) if child_ids else {}
    all_ids = [t.id for t in tasks] + list(child_ids)
    proj_map = graph.project_ids_map(db, all_ids)
    cont_map = graph.container_ids_map(db, all_ids)
    par_map = graph.parent_task_map(db, all_ids)
    result = []
    for t in tasks:
        out = TaskWithSubtasksOut(**_to_out(t, proj_map, par_map, cont_map).model_dump())
        out.subtasks = [
            _to_out(child_by_id[cid], proj_map, par_map, cont_map)
            for cid in children_map.get(t.id, [])
            if cid in child_by_id
        ]
        result.append(out.model_dump())
    return result


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(project_id: str, body: TaskCreate, db: Session = Depends(get_db)):
    project = _get_project_or_404(project_id, db)
    if body.parent_id is not None:
        get_parent_task_or_error(db, project_id, body.parent_id)
    task = graph.create_task(db, project_id=project_id, **body.model_dump())
    task_id = task.id
    log_activity(
        db,
        "task.created",
        project_id=project_id,
        task_id=task_id,
        actor=body.assignee,
        detail=f'Task "{task.title}" created in {project.name}',
        meta={"title": task.title, "priority": task.priority},
    )
    db.commit()
    task = graph.get_task(db, task_id)
    await run_rules(db, "task.created", task, {})
    db.commit()
    task = graph.get_task(db, task_id)
    await fire_notifications(db, task, "task.created")
    await ws_manager.broadcast("task.created", {"project_id": project_id, "task_id": task_id})
    return enrich_task(task, db)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(project_id: str, task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)

    changes = body.model_dump(exclude_none=True)

    # Re-parenting is a graph move, not a column write (ADR-0032): swap the
    # incoming task->task contains edge.
    new_parent_id = changes.pop("parent_id", None)
    if new_parent_id is not None:
        get_parent_task_or_error(db, project_id, new_parent_id, child_id=task_id)
        graph.set_parent_task(db, task_id, new_parent_id)

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
    old_title = task.title
    old_description = task.description
    old_due_date = task.due_date

    if changes:
        task = graph.update_task(db, task_id, **changes)

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
    task = graph.get_task(db, task_id)

    if "status" in changes and changes["status"] != old_status:
        await fire_notifications(db, task, "task.status_changed")
        if changes["status"] == "done":
            await sync_task_closure_to_external(task, db)
        elif old_status == "done":
            await sync_task_reopen_to_external(task, db)
    if "assignee" in changes and changes["assignee"] != old_assignee:
        await fire_notifications(db, task, "task.assigned")

    if task.external_provider:
        changed_fields = set()
        if "title" in changes and changes["title"] != old_title:
            changed_fields.add("title")
        if "description" in changes and changes["description"] != old_description:
            changed_fields.add("description")
        if "assignee" in changes and changes["assignee"] != old_assignee:
            changed_fields.add("assignee")
        if "due_date" in changes and changes["due_date"] != old_due_date:
            changed_fields.add("due_date")
        if changed_fields:
            await sync_task_fields_to_external(task, db, changed_fields)

    for trigger, ctx in triggered_rules:
        await run_rules(db, trigger, task, {"_rule_depth": 1, **ctx})
    if triggered_rules:
        db.commit()
        task = graph.get_task(db, task_id)

    await ws_manager.broadcast("task.updated", {"project_id": project_id, "task_id": task_id})
    return enrich_task(task, db)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(project_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    log_activity(
        db,
        "task.deleted",
        project_id=project_id,
        task_id=task_id,
        actor=task.assignee,
        detail=f'Task "{task.title}" deleted',
        meta={"title": task.title},
    )
    graph.delete_task_tree(db, task.id)
    db.commit()
    await ws_manager.broadcast("task.deleted", {"project_id": project_id, "task_id": task_id})


class CreateExternalIssueBody(BaseModel):
    provider: str | None = None  # "github" | "gitlab"; auto-detected from repo URL when omitted


@router.post("/{task_id}/create-external-issue", response_model=TaskOut)
async def create_external_issue(
    project_id: str,
    task_id: str,
    body: CreateExternalIssueBody | None = None,
    db: Session = Depends(get_db),
):
    """Create a new external issue from this task and link it (explicit action).

    The task becomes the source of truth for the new issue; afterwards the usual
    two-way sync applies. Requires an active issue_sync integration and the
    project's repo URL.
    """
    project = _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    provider = body.provider if body else None
    if provider and provider not in ("github", "gitlab"):
        raise HTTPException(status_code=400, detail="provider must be 'github' or 'gitlab'")
    return await create_external_issue_from_task(task, project, db, provider)


@router.post("/{task_id}/dependencies/{depends_on_id}", status_code=status.HTTP_201_CREATED)
def add_dependency(project_id: str, task_id: str, depends_on_id: str, db: Session = Depends(get_db)):
    """Mark task_id as blocked by depends_on_id (depends_on must complete first)."""
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    blocker = graph.get_task(db, depends_on_id)
    if not blocker or depends_on_id not in graph.contained_task_ids(db, project_id):
        raise HTTPException(status_code=404, detail="Blocker task not found")
    if task_id == depends_on_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    # Dependencies are stored purely as depends_on edges (ADR-0032).
    graph.ensure_node(db, task_id, graph.NODE_TASK, title=task.title)
    graph.ensure_node(db, depends_on_id, graph.NODE_TASK, title=blocker.title)
    graph.add_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON)
    db.commit()
    return {"task_id": task_id, "depends_on_id": depends_on_id}


@router.delete("/{task_id}/dependencies/{depends_on_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_dependency(project_id: str, task_id: str, depends_on_id: str, db: Session = Depends(get_db)):
    """Remove the blocked-by dependency between task_id and depends_on_id."""
    _get_project_or_404(project_id, db)
    if not graph.remove_edge(db, task_id, depends_on_id, graph.REL_DEPENDS_ON):
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.commit()


@router.post("/{task_id}/memberships/{target_project_id}", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def add_membership(project_id: str, task_id: str, target_project_id: str, db: Session = Depends(get_db)):
    """Link a task into an additional project via a graph ``contains`` edge (ADR-0032).

    Memberships are symmetric (no primary): this simply adds another
    project -> task edge so the task also surfaces under target_project_id.
    """
    _get_project_or_404(project_id, db)
    task = get_task_or_404(task_id, db, project_id=project_id)
    if target_project_id == project_id:
        raise HTTPException(status_code=400, detail="Task already belongs to this project")
    _get_project_or_404(target_project_id, db)

    graph.ensure_node(db, target_project_id, graph.NODE_PROJECT)
    graph.ensure_node(db, task_id, graph.NODE_TASK, title=task.title)
    graph.add_edge(db, target_project_id, task_id, graph.REL_CONTAINS)
    log_activity(
        db,
        "task.membership_added",
        project_id=target_project_id,
        task_id=task_id,
        actor="api",
        detail=f"Task linked into project {target_project_id}",
    )
    db.commit()
    await ws_manager.broadcast("task.updated", {"task_id": task_id, "project_id": target_project_id})
    return enrich_task(graph.get_task(db, task_id), db)


@router.delete("/{task_id}/memberships/{target_project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_membership(project_id: str, task_id: str, target_project_id: str, db: Session = Depends(get_db)):
    """Unlink a task from a project (ADR-0032/0033, no primary: any membership may go).

    A task may legally reach zero project memberships — it becomes *unfiled* and
    surfaces in the unfiled bucket (``GET /tasks/unfiled``) to be re-filed later.
    """
    _get_project_or_404(project_id, db)
    get_task_or_404(task_id, db, project_id=project_id)
    member_ids = graph.member_project_ids(db, task_id)
    if target_project_id not in member_ids:
        raise HTTPException(status_code=404, detail="Membership not found")
    graph.remove_edge(db, target_project_id, task_id, graph.REL_CONTAINS)
    log_activity(
        db,
        "task.membership_removed",
        project_id=target_project_id,
        task_id=task_id,
        actor="api",
        detail=f"Task unlinked from project {target_project_id}",
    )
    db.commit()
    await ws_manager.broadcast("task.updated", {"task_id": task_id, "project_id": target_project_id})


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(project_id: str, body: ReorderRequest, db: Session = Depends(get_db)):
    """Set the position of each task according to the given ordered list of IDs."""
    _get_project_or_404(project_id, db)
    contained = set(graph.contained_task_ids(db, project_id))
    task_types = graph.task_type_keys(db)
    for idx, task_id in enumerate(body.task_ids):
        if task_id in contained:
            db.query(Node).filter(Node.id == task_id, Node.type.in_(task_types)).update({"position": idx})
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
    task = get_task_or_404(task_id, db, project_id=project_id)
    task = graph.update_task(db, task_id, callback_token=str(uuid.uuid4()))
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
    return enrich_task(graph.get_task(db, task_id), db)


# Top-level task operations that are not scoped to a single project. Registered
# separately in main.py. Handles the "unfiled" bucket: tasks with zero project
# memberships (ADR-0032/0033), and filing an unfiled task into a project.
task_ops_router = APIRouter(prefix="/tasks", tags=["tasks"])


@task_ops_router.get("/unfiled", response_model=list[TaskOut])
def list_unfiled_tasks(db: Session = Depends(get_db)):
    """List unfiled tasks — tasks that belong to no project (ADR-0032/0033)."""
    ids = graph.unfiled_task_ids(db)
    if not ids:
        return []
    return [enrich_task(t, db) for t in graph.task_views_for_ids(db, ids)]


@task_ops_router.post(
    "/{task_id}/memberships/{project_id}", response_model=TaskOut, status_code=status.HTTP_201_CREATED
)
async def file_task_into_project(task_id: str, project_id: str, db: Session = Depends(get_db)):
    """File a task into a project via a ``contains`` edge (unscoped; ADR-0032/0033).

    Unlike the project-scoped membership endpoint this does not require the task
    to already live under some source project, so it is how an *unfiled* task
    gets its first project. Idempotent: adding an existing membership is a no-op.
    """
    task = graph.get_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    _get_project_or_404(project_id, db)
    graph.ensure_node(db, project_id, graph.NODE_PROJECT)
    graph.ensure_node(db, task_id, graph.NODE_TASK, title=task.title)
    graph.add_edge(db, project_id, task_id, graph.REL_CONTAINS)
    log_activity(
        db,
        "task.membership_added",
        project_id=project_id,
        task_id=task_id,
        actor="api",
        detail=f"Task filed into project {project_id}",
    )
    db.commit()
    await ws_manager.broadcast("task.updated", {"task_id": task_id, "project_id": project_id})
    return enrich_task(graph.get_task(db, task_id), db)
