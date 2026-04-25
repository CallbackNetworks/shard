import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, Cycle, CycleTask, Task
from app.schemas import CycleCreate, CycleUpdate, CycleOut
from app.routers.deps import get_project_or_404 as _get_project_or_404

router = APIRouter(prefix="/projects/{project_id}/cycles", tags=["cycles"])


def _enrich_cycle(cycle: Cycle) -> CycleOut:
    task_ids = [ct.task_id for ct in cycle.cycle_tasks]
    tasks = [ct.task for ct in cycle.cycle_tasks if ct.task is not None]
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
    cycles = db.query(Cycle).filter(Cycle.project_id == project_id).order_by(Cycle.created_at.asc()).all()
    return [_enrich_cycle(c) for c in cycles]


@router.post("", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
def create_cycle(project_id: str, body: CycleCreate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = Cycle(project_id=project_id, **body.model_dump())
    db.add(cycle)
    db.commit()
    db.refresh(cycle)
    return _enrich_cycle(cycle)


@router.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id, Cycle.project_id == project_id).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return _enrich_cycle(cycle)


@router.patch("/{cycle_id}", response_model=CycleOut)
def update_cycle(project_id: str, cycle_id: str, body: CycleUpdate, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id, Cycle.project_id == project_id).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cycle, field, value)
    db.commit()
    db.refresh(cycle)
    return _enrich_cycle(cycle)


@router.delete("/{cycle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id, Cycle.project_id == project_id).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    db.delete(cycle)
    db.commit()


@router.post("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_201_CREATED)
def add_task_to_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    cycle = db.query(Cycle).filter(Cycle.id == cycle_id, Cycle.project_id == project_id).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    existing = db.query(CycleTask).filter(
        CycleTask.cycle_id == cycle_id, CycleTask.task_id == task_id
    ).first()
    if not existing:
        ct = CycleTask(cycle_id=cycle_id, task_id=task_id)
        db.add(ct)
        db.commit()
    return {"cycle_id": cycle_id, "task_id": task_id}


@router.delete("/{cycle_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_task_from_cycle(project_id: str, cycle_id: str, task_id: str, db: Session = Depends(get_db)):
    _get_project_or_404(project_id, db)
    ct = db.query(CycleTask).filter(
        CycleTask.cycle_id == cycle_id, CycleTask.task_id == task_id
    ).first()
    if not ct:
        raise HTTPException(status_code=404, detail="Task not in cycle")
    db.delete(ct)
    db.commit()


@router.post("/{cycle_id}/duplicate", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
def duplicate_cycle(project_id: str, cycle_id: str, db: Session = Depends(get_db)):
    """Create a new draft cycle with cloned tasks from an existing cycle (cycle template)."""
    _get_project_or_404(project_id, db)
    source = db.query(Cycle).filter(Cycle.id == cycle_id, Cycle.project_id == project_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Cycle not found")

    new_cycle = Cycle(
        id=str(uuid.uuid4()),
        project_id=project_id,
        name=f"{source.name} (copy)",
        description=source.description,
        status="draft",
    )
    db.add(new_cycle)
    db.flush()

    # Clone tasks as new todo tasks and link to new cycle
    for ct in source.cycle_tasks:
        src_task = ct.task
        if not src_task:
            continue
        new_task = Task(
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
        db.add(new_task)
        db.flush()
        db.add(CycleTask(cycle_id=new_cycle.id, task_id=new_task.id))

    db.commit()
    db.refresh(new_cycle)
    return _enrich_cycle(new_cycle)


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
        cycle = db.query(Cycle).filter(Cycle.id == cid, Cycle.project_id == project_id).first()
        if not cycle:
            return None
        tasks = [ct.task for ct in cycle.cycle_tasks if ct.task]
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
