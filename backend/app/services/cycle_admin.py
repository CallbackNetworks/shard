"""Reading cycles, for both doors (ADR-0086).

A cycle is created and deleted as a node (ADR-0043) and its membership is the ``in_cycle``
edge, so ``/api/v1`` could always *put a task into* a cycle and never read what one
contains. Writable and unreadable is the same asymmetry as readable-and-unwritable, from
the other side.

Only the reads live here. ``duplicate`` and the add/remove-task routes stay on the internal
router: they broadcast over the websocket and run the task-create pipeline, and v1 reaches
the same membership through the edge surface it already has.
"""

from sqlalchemy.orm import Session

from app.schemas import CycleOut
from app.services import graph
from app.services.errors import NotFound


def enrich(db: Session, cycle: graph.CycleView) -> CycleOut:
    tasks = graph.tasks_in_cycle(db, cycle.id)
    out = CycleOut.model_validate(cycle)
    out.task_ids = [t.id for t in tasks]
    out.total_tasks = len(tasks)
    out.done_tasks = sum(1 for t in tasks if t.status == "done")
    return out


def _project_or_404(db: Session, project_id: str) -> None:
    if graph.get_project(db, project_id) is None:
        raise NotFound("Project not found")


def _cycle_or_404(db: Session, project_id: str, cycle_id: str) -> graph.CycleView:
    cycle = graph.get_cycle(db, cycle_id, project_id=project_id)
    if not cycle:
        raise NotFound("Cycle not found")
    return cycle


def list_cycles(db: Session, project_id: str) -> list[CycleOut]:
    _project_or_404(db, project_id)
    return [enrich(db, c) for c in graph.cycles_in_project(db, project_id)]


def get_cycle(db: Session, project_id: str, cycle_id: str) -> CycleOut:
    _project_or_404(db, project_id)
    return enrich(db, _cycle_or_404(db, project_id, cycle_id))


def _stats(db: Session, project_id: str, cycle_id: str) -> dict | None:
    cycle = graph.get_cycle(db, cycle_id, project_id=project_id)
    if not cycle:
        return None
    tasks = graph.tasks_in_cycle(db, cycle.id)
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    duration_days = None
    if cycle.start_date and cycle.end_date:
        duration_days = (cycle.end_date - cycle.start_date).days
    return {
        "cycle_id": cycle.id,
        "name": cycle.name,
        "status": cycle.status,
        "total_tasks": total,
        "done": done,
        "in_progress": sum(1 for t in tasks if t.status == "in_progress"),
        "failed": sum(1 for t in tasks if t.status == "failed"),
        "completion_rate": round(done / total * 100, 1) if total else 0,
        "duration_days": duration_days,
        "total_estimate_min": sum(t.time_estimate or 0 for t in tasks),
        "total_spent_min": sum(t.time_spent or 0 for t in tasks),
        "start_date": cycle.start_date.isoformat() if cycle.start_date else None,
        "end_date": cycle.end_date.isoformat() if cycle.end_date else None,
    }


def compare(db: Session, project_id: str, cycle_id: str, compare_with: str) -> dict:
    """Two cycles side by side: task counts, completion rates, time."""
    _project_or_404(db, project_id)
    a = _stats(db, project_id, cycle_id)
    b = _stats(db, project_id, compare_with)
    if not a:
        raise NotFound("Cycle not found")
    if not b:
        raise NotFound("Comparison cycle not found")
    return {"cycle_a": a, "cycle_b": b}
