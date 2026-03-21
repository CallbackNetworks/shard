from fastapi import APIRouter, Depends, HTTPException, status
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
