"""Reading cycles, for both doors (ADR-0086).

A cycle is created and deleted as a node (ADR-0043) and its membership is the ``in_cycle``
edge, so ``/api/v1`` could always *put a task into* a cycle and never read what one
contains. Writable and unreadable is the same asymmetry as readable-and-unwritable, from
the other side.

The add/remove-task routes stay on the internal router: v1 reaches the same membership
through the edge surface it already has (``in_cycle`` declares its endpoints, ADR-0078).

``duplicate`` moved here in ADR-0092. It was left out originally because it broadcasts over
the websocket and runs the task-create pipeline — but that describes where the code lived,
not who may call it, and rolling a sprint over is planning work, which is what an agent is
for. A service can broadcast; ``task_import`` already does.
"""

import uuid

from sqlalchemy.orm import Session

from app.schemas import CycleOut
from app.services import graph
from app.services.errors import NotFound
from app.services.task_mutations import finalize_task_create
from app.services.ws_manager import ws_manager


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


async def duplicate(db: Session, project_id: str, cycle_id: str) -> CycleOut:
    """A new draft cycle holding fresh todo copies of another cycle's tasks.

    The clone carries the plan — title, description, priority, assignee, estimate — and
    none of the history: status resets to ``todo``, and time spent does not follow. What
    is being copied is the intent to do the work, not the record of having done it.
    """
    _project_or_404(db, project_id)
    source = _cycle_or_404(db, project_id, cycle_id)

    new_cycle = graph.create_cycle(
        db,
        project_id,
        id=str(uuid.uuid4()),
        name=f"{source.name} (copy)",
        description=source.description,
        status="draft",
    )

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
    return enrich(db, new_cycle)


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
