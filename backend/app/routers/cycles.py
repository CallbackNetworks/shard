import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers.deps import get_cycle_or_404, get_task_or_404
from app.routers.deps import get_project_or_404 as _get_project_or_404
from app.routers.issue_sync import sync_task_milestone_to_external
from app.schemas import CycleCreate, CycleOut, CycleUpdate
from app.services import graph

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


@router.post("", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
def create_cycle(project_id: str, body: CycleCreate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = graph.create_cycle(db, project_id, **body.model_dump())
    db.commit()
    return _enrich_cycle(cycle, db)


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = get_cycle_or_404(cycle_id, db, project_id=project_id)
    return _enrich_cycle(cycle, db)


@router.patch("/{cycle_id}", response_model=CycleOut)
def update_cycle(project_id: str, cycle_id: str, body: CycleUpdate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    get_cycle_or_404(cycle_id, db, project_id=project_id)
    cycle = graph.update_cycle(db, cycle_id, **body.model_dump(exclude_none=True))
    db.commit()
    return _enrich_cycle(cycle, db)


@router.delete("/{cycle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    get_cycle_or_404(cycle_id, db, project_id=project_id)
    graph.delete_cycle(db, cycle_id)
    db.commit()


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
def duplicate_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
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

    db.commit()
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
