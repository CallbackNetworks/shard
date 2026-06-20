from app.models import RecurrenceRule
from app.schemas import CycleOut, IdentityOut, LabelOut, ProjectOut, RecurrenceRuleOut, TaskOut


def enrich_task(task, db=None) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by = [d.depends_on_id for d in task.blocked_by_deps]
    out.blocking = [d.task_id for d in task.blocking_deps]
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    if db is not None:
        rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task.id).first()
        out.recurrence = RecurrenceRuleOut.model_validate(rule) if rule else None
    return out


def enrich_task_as_dict(task) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = [LabelOut.model_validate(tl.label) for tl in task.task_labels if tl.label is not None]
    out.subtask_count = len(task.subtasks)
    out.comment_count = len(task.comments)
    out.blocked_by = [d.depends_on_id for d in task.blocked_by_deps]
    out.blocking = [d.task_id for d in task.blocking_deps]
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
    out.tasks = [enrich_task(t, db) for t in project.tasks]
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
