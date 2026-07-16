from sqlalchemy.orm import selectinload

from app.models import RecurrenceRule, Task
from app.schemas import CycleOut, IdentityOut, LabelOut, ProjectOut, RecurrenceRuleOut, TaskOut, TaskPullRequestOut
from app.services import graph


def _membership_project_ids(task, db) -> list[str]:
    """Projects a task belongs to, derived from ``contains`` edges (ADR-0032, no primary).

    The graph is the authority for membership; the ``project_id`` column is only a
    compat fallback when no db session is available to consult the edges.
    """
    if db is not None:
        return graph.member_project_ids(db, task.id)
    return [task.project_id] if task.project_id else []


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


def enrich_task(task, db=None, dep_maps=None, labels_by_task=None) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    out.project_ids = _membership_project_ids(task, db)
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    if db is not None:
        rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task.id).first()
        out.recurrence = RecurrenceRuleOut.model_validate(rule) if rule else None
    return out


def enrich_task_as_dict(task, db=None, dep_maps=None, labels_by_task=None) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()


def enrich_project(project, db=None) -> ProjectOut:
    # Tasks belonging to this project come from graph ``contains`` edges (ADR-0032,
    # no primary): this naturally includes cross-project members. Falls back to the
    # ORM relationship only when no db session is available.
    if db is not None:
        task_ids = graph.contained_task_ids(db, project.id)
        tasks = (
            db.query(Task)
            .options(
                selectinload(Task.subtasks),
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
        tasks = list(project.tasks)

    top_tasks = [t for t in tasks if t.parent_id is None]
    total = len(top_tasks)
    done = sum(1 for t in top_tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    out = ProjectOut.model_validate(project)
    out.total_tasks = total
    out.done_tasks = done
    out.progress = progress

    # Batch-load dependency and label edges once for all tasks in the project.
    task_ids = [t.id for t in tasks]
    dep_maps = graph.dependency_maps(db, task_ids) if db is not None else None
    labels_by_task = graph.labels_map(db, task_ids) if db is not None else None
    out.tasks = [enrich_task(t, db, dep_maps, labels_by_task) for t in tasks]

    out.labels = [LabelOut.model_validate(lb) for lb in project.labels]

    enriched_cycles = []
    for cycle in project.cycles:
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
