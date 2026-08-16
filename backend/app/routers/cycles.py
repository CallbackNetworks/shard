import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_cycle_or_404, get_task_or_404
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.schemas import CycleOut
from app.services import cycle_admin, graph
from app.services.graph_dispatch import dispatch_edge_added, dispatch_edge_removed
from app.services.task_mutations import finalize_task_create
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/projects/{project_id}/cycles", tags=["cycles"])


def _enrich_cycle(cycle: graph.CycleView, db: Session) -> CycleOut:
    # One enrichment, shared with `/api/v1` (ADR-0086).
    return cycle_admin.enrich(db, cycle)


@router.get("", response_model=list[CycleOut])
def list_cycles(project_id: str, db: Session = Depends(get_db)):
    return cycle_admin.list_cycles(db, project_id)


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    return cycle_admin.get_cycle(db, project_id, cycle_id)


# Cycle create/update/delete retired (ADR-0043): a cycle is a container-scoped node —
# create via POST /api/nodes (type "cycle", container_id = project; end_date -> due_date)
# + update/delete via /api/nodes/{id}. Reads, task↔cycle linking, duplicate, and compare
# stay (duplicate/compare are transforms/reads, not a second single-entity write path).


@router.post("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_201_CREATED)
async def add_task_to_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    get_cycle_or_404(cycle_id, db, project_id=project_id)
    get_task_or_404(task_id, db, project_id=project_id)
    if task_id not in graph.task_ids_in_cycle(db, cycle_id):
        graph.add_to_cycle(db, cycle_id, task_id)
        await dispatch_edge_added(db, task_id, cycle_id, graph.REL_IN_CYCLE)
    return {"cycle_id": cycle_id, "task_id": task_id}


@router.delete("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task_from_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    if not graph.remove_from_cycle(db, cycle_id, task_id):
        raise HTTPException(status_code=404, detail="Task not in cycle")
    await dispatch_edge_removed(db, task_id, cycle_id, graph.REL_IN_CYCLE)


@router.post("/{cycle_id}/duplicate", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
async def duplicate_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    """Create a new draft cycle with cloned tasks from an existing cycle (cycle template)."""
    _get_project_or_404(project_id, db)
    source = get_cycle_or_404(cycle_id, db, project_id=project_id)

    new_cycle = graph.create_cycle(
        db,
        project_id,
        id=str(uuid.uuid4()),
        name=f"{source.name} (copy)",
        description=source.description,
        status="draft",
    )

    # Clone tasks as new todo tasks and link to new cycle
    created_ids: list[str] = []
    for src_task in graph.tasks_in_cycle(db, source.id):
        new_task = graph.create_task(
            db,
            id=str(uuid.uuid4()),
            project_id=project_id,
            title=src_task.title,
            description=src_task.description,
            priority=src_task.priority,
            assignee=src_task.assignee,
            status="todo",
            callback_token=str(uuid.uuid4()),
            time_estimate=src_task.time_estimate,
        )
        graph.add_to_cycle(db, new_cycle.id, new_task.id)
        # Cycle membership is linked first so cycle-scoped workflow rules see
        # the clone where it actually belongs.
        await finalize_task_create(
            db,
            new_task.id,
            actor="system",
            source="duplicate",
            project_id=project_id,
            activity_meta={"cycle_id": new_cycle.id, "source_task_id": src_task.id},
            commit=False,
            broadcast=False,
        )
        created_ids.append(new_task.id)

    db.commit()
    await ws_manager.broadcast(
        "task.imported",
        {"project_id": project_id, "task_ids": created_ids, "cycle_id": new_cycle.id},
    )
    return _enrich_cycle(new_cycle, db)


@router.get("/{cycle_id}/compare")
def compare_cycles(
    project_id: str,
    cycle_id: str,
    compare_with: str = Query(..., description="Cycle ID to compare with"),
    db: Session = Depends(get_db),
):
    """Compare two cycles side-by-side: task counts, completion rates, velocity."""
    return cycle_admin.compare(db, project_id, cycle_id, compare_with)
