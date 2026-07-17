from sqlalchemy.orm import selectinload

from app.models import RecurrenceRule, Task
from app.schemas import CycleOut, IdentityOut, LabelOut, ProjectOut, RecurrenceRuleOut, TaskOut, TaskPullRequestOut
from app.services import graph


def _membership_project_ids(task, db, project_ids_by_task) -> list[str]:
    """Projects a task belongs to, derived from ``contains`` edges (ADR-0032, no primary).

    ``project_ids_by_task`` is an optional prefetched ``{task_id: [project_id]}`` map
    (``graph.project_ids_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if project_ids_by_task is not None:
        return list(project_ids_by_task.get(task.id, []))
    if db is not None:
        return graph.member_project_ids(db, task.id)
    return []


def _parent_id(task, db, parent_by_task) -> str | None:
    """A subtask's parent task id via the incoming task->task ``contains`` edge (ADR-0032).

    ``parent_by_task`` is an optional prefetched ``{task_id: parent_id}`` map
    (``graph.parent_task_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if parent_by_task is not None:
        return parent_by_task.get(task.id)
    if db is not None:
        return graph.parent_task_map(db, [task.id]).get(task.id)
    return None


def _dependency_lists(task, db, dep_maps) -> tuple[list[str], list[str]]:
    """Resolve (blocked_by, blocking) from depends_on edges (ADR-0032).

    ``dep_maps`` is an optional prefetched ``(blocked_by, blocking)`` pair from
    ``graph.dependency_maps`` used to batch a whole list of tasks (avoids N+1).
    """
    if dep_maps is not None:
        return dep_maps[0].get(task.id, []), dep_maps[1].get(task.id, [])
    if db is not None:
        return graph.prerequisite_ids(db, task.id), graph.dependent_ids(db, task.id)
    return [], []


def _task_labels(task, db, labels_by_task) -> list[LabelOut]:
    """Resolve a task's labels from ``labeled`` edges (ADR-0032).

    ``labels_by_task`` is an optional prefetched ``{task_id: [Label]}`` map from
    ``graph.labels_map`` used to batch a whole list of tasks (avoids N+1).
    """
    if labels_by_task is not None:
        labels = labels_by_task.get(task.id, [])
    elif db is not None:
        labels = graph.labels_for_task(db, task.id)
    else:
        labels = []
    return [LabelOut.model_validate(lb) for lb in labels]


def _subtask_count(task, db, subtasks_by_task) -> int:
    """Number of subtasks via task->task ``contains`` edges (ADR-0032).

    ``subtasks_by_task`` is an optional prefetched ``{task_id: [child_id]}`` map
    (``graph.child_task_ids_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if subtasks_by_task is not None:
        return len(subtasks_by_task.get(task.id, []))
    if db is not None:
        return len(graph.contained_task_ids(db, task.id))
    return 0


def _apply_containment(out, task, db, project_ids_by_task, parent_by_task) -> None:
    """Populate the compat ``project_id``/``project_ids``/``parent_id`` from edges."""
    out.project_ids = _membership_project_ids(task, db, project_ids_by_task)
    out.project_id = out.project_ids[0] if out.project_ids else None
    out.parent_id = _parent_id(task, db, parent_by_task)


def enrich_task(
    task,
    db=None,
    dep_maps=None,
    labels_by_task=None,
    subtasks_by_task=None,
    project_ids_by_task=None,
    parent_by_task=None,
) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = _subtask_count(task, db, subtasks_by_task)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    _apply_containment(out, task, db, project_ids_by_task, parent_by_task)
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    if db is not None:
        rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task.id).first()
        out.recurrence = RecurrenceRuleOut.model_validate(rule) if rule else None
    return out


def enrich_task_as_dict(
    task,
    db=None,
    dep_maps=None,
    labels_by_task=None,
    subtasks_by_task=None,
    project_ids_by_task=None,
    parent_by_task=None,
) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = _subtask_count(task, db, subtasks_by_task)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    _apply_containment(out, task, db, project_ids_by_task, parent_by_task)
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()


def enrich_project(project, db=None) -> ProjectOut:
    # Tasks belonging to this project come from graph ``contains`` edges (ADR-0032,
    # no primary): this naturally includes cross-project members.
    if db is not None:
        task_ids = graph.contained_task_ids(db, project.id)
        tasks = (
            db.query(Task)
            .options(
                selectinload(Task.comments),
                selectinload(Task.pull_requests),
                selectinload(Task.assigned_agent),
            )
            .filter(Task.id.in_(task_ids))
            .all()
            if task_ids
            else []
        )
    else:
        tasks = []

    # Top-level tasks = not a subtask of any task (no incoming task->task contains edge).
    subtask_set = graph.subtask_ids_among(db, [t.id for t in tasks]) if db is not None else set()
    top_tasks = [t for t in tasks if t.id not in subtask_set]
    total = len(top_tasks)
    done = sum(1 for t in top_tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    out = ProjectOut.model_validate(project)
    out.total_tasks = total
    out.done_tasks = done
    out.progress = progress

    # Batch-load dependency, label, subtask and containment edges once for all tasks.
    task_ids = [t.id for t in tasks]
    dep_maps = graph.dependency_maps(db, task_ids) if db is not None else None
    labels_by_task = graph.labels_map(db, task_ids) if db is not None else None
    subtasks_by_task = graph.child_task_ids_map(db, task_ids) if db is not None else None
    project_ids_by_task = graph.project_ids_map(db, task_ids) if db is not None else None
    parent_by_task = graph.parent_task_map(db, task_ids) if db is not None else None
    out.tasks = [
        enrich_task(t, db, dep_maps, labels_by_task, subtasks_by_task, project_ids_by_task, parent_by_task)
        for t in tasks
    ]

    project_labels = graph.labels_in_project(db, project.id) if db is not None else []
    out.labels = [LabelOut.model_validate(lb) for lb in project_labels]

    enriched_cycles = []
    project_cycles = graph.cycles_in_project(db, project.id) if db is not None else []
    for cycle in project_cycles:
        tasks = graph.tasks_in_cycle(db, cycle.id) if db is not None else []
        task_ids = [t.id for t in tasks]
        c_total = len(tasks)
        c_done = sum(1 for t in tasks if t.status == "done")
        cout = CycleOut.model_validate(cycle)
        cout.task_ids = task_ids
        cout.total_tasks = c_total
        cout.done_tasks = c_done
        enriched_cycles.append(cout)
    out.cycles = enriched_cycles

    out.identities = (
        [
            IdentityOut(
                id=i.id,
                name=i.name,
                color=i.color,
                description=i.description,
                avatar=i.avatar,
                created_at=i.created_at,
                project_count=len(graph.project_ids_for_identity(db, i.id)),
            )
            for i in graph.identities_for_project(db, project.id)
        ]
        if db is not None
        else []
    )

    return out
