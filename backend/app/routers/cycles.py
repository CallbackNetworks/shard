import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_cycle_or_404, get_task_or_404
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.routers.issue_sync import sync_task_milestone_to_external
from app.schemas import CycleOut
from app.services import graph
from app.services.task_mutations import finalize_task_create
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/projects/{project_id}/cycles", tags=["cycles"])


def _enrich_cycle(cycle: graph.CycleView, db: Session) -> CycleOut:
    tasks = graph.tasks_in_cycle(db, cycle.id)
    task_ids = [t.id for t in tasks]
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    out = CycleOut.model_validate(cycle)
    out.task_ids = task_ids
    out.total_tasks = total
    out.done_tasks = done
    return out


@router.get("", response_model=list[CycleOut])
def list_cycles(project_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    return [_enrich_cycle(c, db) for c in graph.cycles_in_project(db, project_id)]


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = get_cycle_or_404(cycle_id, db, project_id=project_id)
    return _enrich_cycle(cycle, db)


# Cycle create/update/delete retired (ADR-0043): a cycle is a container-scoped node —
# create via POST /api/nodes (type "cycle", container_id = project; end_date -> due_date)
# + update/delete via /api/nodes/{id}. Reads, task↔cycle linking, duplicate, and compare
# stay (duplicate/compare are transforms/reads, not a second single-entity write path).


@router.post("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_201_CREATED)
async def add_task_to_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    get_cycle_or_404(cycle_id, db, project_id=project_id)
    task = get_task_or_404(task_id, db, project_id=project_id)
    if task_id not in graph.task_ids_in_cycle(db, cycle_id):
        graph.add_to_cycle(db, cycle_id, task_id)
        db.commit()
        if task.external_provider:
            await sync_task_milestone_to_external(task, db)
    return {"cycle_id": cycle_id, "task_id": task_id}


@router.delete("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_task_from_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    if not graph.remove_from_cycle(db, cycle_id, task_id):
        raise HTTPException(status_code=404, detail="Task not in cycle")
    db.commit()
    task = graph.get_task(db, task_id)
    if task and task.external_provider:
        await sync_task_milestone_to_external(task, db)


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
    _get_project_or_404(project_id, db)

    def _stats(cid):
        cycle = graph.get_cycle(db, cid, project_id=project_id)
        if not cycle:
            return None
        tasks = graph.tasks_in_cycle(db, cycle.id)
        total = len(tasks)
        done = sum(1 for t in tasks if t.status == "done")
        failed = sum(1 for t in tasks if t.status == "failed")
        in_prog = sum(1 for t in tasks if t.status == "in_progress")
        est = sum(t.time_estimate or 0 for t in tasks)
        spent = sum(t.time_spent or 0 for t in tasks)
        duration_days = None
        if cycle.start_date and cycle.end_date:
            duration_days = (cycle.end_date - cycle.start_date).days
        return {
            "cycle_id": cycle.id,
            "name": cycle.name,
            "status": cycle.status,
            "total_tasks": total,
            "done": done,
            "in_progress": in_prog,
            "failed": failed,
            "completion_rate": round(done / total * 100, 1) if total else 0,
            "duration_days": duration_days,
            "total_estimate_min": est,
            "total_spent_min": spent,
            "start_date": cycle.start_date.isoformat() if cycle.start_date else None,
            "end_date": cycle.end_date.isoformat() if cycle.end_date else None,
        }

    a = _stats(cycle_id)
    b = _stats(compare_with)
    if not a:
        raise HTTPException(status_code=404, detail="Cycle not found")
    if not b:
        raise HTTPException(status_code=404, detail="Comparison cycle not found")
    return {"cycle_a": a, "cycle_b": b}
