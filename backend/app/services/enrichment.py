from app.models import RecurrenceRule, Task
from app.schemas import CycleOut, IdentityOut, LabelOut, ProjectOut, RecurrenceRuleOut, TaskOut, TaskPullRequestOut
from app.services import graph


def _membership_project_ids(task, db) -> list[str]:
    """Unique projects a task belongs to: primary column plus graph ``contains`` edges."""
    ids = [task.project_id] if task.project_id else []
    if db is not None:
        for pid in graph.member_project_ids(db, task.id):
            if pid not in ids:
                ids.append(pid)
    return ids


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


def enrich_task(task, db=None, dep_maps=None) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
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


def enrich_task_as_dict(task, db=None, dep_maps=None) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()


def enrich_project(project, db=None) -> ProjectOut:
    top_tasks = [t for t in project.tasks if t.parent_id is None]
    total = len(top_tasks)
    done = sum(1 for t in top_tasks if t.status == "done")
    progress = round(done / total * 100, 1) if total > 0 else 0.0
    out = ProjectOut.model_validate(project)
    out.total_tasks = total
    out.done_tasks = done
    out.progress = progress
    tasks = list(project.tasks)

    # Tasks linked into this project via graph contains edges but whose primary
    # project_id is elsewhere — cross-project membership (ADR-0032).
    if db is not None:
        own_ids = {t.id for t in tasks}
        extra_ids = [tid for tid in graph.contained_task_ids(db, project.id) if tid not in own_ids]
        if extra_ids:
            tasks += db.query(Task).filter(Task.id.in_(extra_ids)).all()

    # Batch-load dependency edges once for all tasks in the project.
    dep_maps = graph.dependency_maps(db, [t.id for t in tasks]) if db is not None else None
    out.tasks = [enrich_task(t, db, dep_maps) for t in tasks]

    out.labels = [LabelOut.model_validate(lb) for lb in project.labels]

    enriched_cycles = []
    for cycle in project.cycles:
        task_ids = [ct.task_id for ct in cycle.cycle_tasks]
        tasks = [ct.task for ct in cycle.cycle_tasks if ct.task is not None]
        c_total = len(tasks)
        c_done = sum(1 for t in tasks if t.status == "done")
        cout = CycleOut.model_validate(cycle)
        cout.task_ids = task_ids
        cout.total_tasks = c_total
        cout.done_tasks = c_done
        enriched_cycles.append(cout)
    out.cycles = enriched_cycles

    out.identities = [
        IdentityOut(
            id=pi.identity.id,
            name=pi.identity.name,
            color=pi.identity.color,
            description=pi.identity.description,
            avatar=pi.identity.avatar,
            created_at=pi.identity.created_at,
            project_count=len(pi.identity.project_identities),
        )
        for pi in project.project_identities
        if pi.identity is not None
    ]

    return out
