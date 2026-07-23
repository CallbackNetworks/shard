import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Node
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.routers.deps import get_task_or_404
from app.routers.issue_sync import create_external_issue_from_task
from app.schemas import ReorderRequest, TaskOut, TaskWithSubtasksOut
from app.services import graph
from app.services.activity import log_activity
from app.services.enrichment import enrich_task
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


# Task create/patch/delete are retired (ADR-0040 stage 3c): the single graph write
# surface ``/api/nodes`` (POST with type="task" + container_id/parent_id; PATCH /{id};
# DELETE /{id}) is now the canonical entry. This router keeps task *reads* and the
# task-scoped *sub-resources* (dependencies, memberships, reorder, external issue,
# regenerate-token, comments/labels/cycles/recurrence/attachments) below.


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
