from app.models import RecurrenceRule
from app.schemas import (
    ContainerSubtree,
    ContainerSummary,
    CycleOut,
    IdentityOut,
    LabelOut,
    ProjectOut,
    RecurrenceRuleOut,
    TaskOut,
    TaskPullRequestOut,
)
from app.services import graph


def _membership_project_ids(task, db, project_ids_by_task) -> list[str]:
    """Projects a task belongs to, derived from ``contains`` edges (ADR-0032, no primary).

    ``project_ids_by_task`` is an optional prefetched ``{task_id: [project_id]}`` map
    (``graph.project_ids_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if project_ids_by_task is not None:
        return list(project_ids_by_task.get(task.id, []))
    return graph.member_project_ids(db, task.id)


def _membership_container_ids(task, db, container_ids_by_task) -> list[str]:
    """Containers a task belongs to (generic ``is_container`` superset, ADR-0034).

    ``container_ids_by_task`` is an optional prefetched ``{task_id: [container_id]}`` map
    (``graph.container_ids_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if container_ids_by_task is not None:
        return list(container_ids_by_task.get(task.id, []))
    return graph.member_container_ids(db, task.id)


def _parent_id(task, db, parent_by_task) -> str | None:
    """A subtask's parent task id via the incoming task->task ``contains`` edge (ADR-0032).

    ``parent_by_task`` is an optional prefetched ``{task_id: parent_id}`` map
    (``graph.parent_task_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if parent_by_task is not None:
        return parent_by_task.get(task.id)
    return graph.parent_task_map(db, [task.id]).get(task.id)


def _dependency_lists(task, db, dep_maps) -> tuple[list[str], list[str]]:
    """Resolve (blocked_by, blocking) from depends_on edges (ADR-0032).

    ``dep_maps`` is an optional prefetched ``(blocked_by, blocking)`` pair from
    ``graph.dependency_maps`` used to batch a whole list of tasks (avoids N+1).
    """
    if dep_maps is not None:
        return dep_maps[0].get(task.id, []), dep_maps[1].get(task.id, [])
    return graph.prerequisite_ids(db, task.id), graph.dependent_ids(db, task.id)


def _task_labels(task, db, labels_by_task) -> list[LabelOut]:
    """Resolve a task's labels from ``labeled`` edges (ADR-0032).

    ``labels_by_task`` is an optional prefetched ``{task_id: [Label]}`` map from
    ``graph.labels_map`` used to batch a whole list of tasks (avoids N+1).
    """
    if labels_by_task is not None:
        labels = labels_by_task.get(task.id, [])
    else:
        labels = graph.labels_for_task(db, task.id)
    return [LabelOut.model_validate(lb) for lb in labels]


def _subtask_count(task, db, subtasks_by_task) -> int:
    """Number of subtasks via task->task ``contains`` edges (ADR-0032).

    ``subtasks_by_task`` is an optional prefetched ``{task_id: [child_id]}`` map
    (``graph.child_task_ids_map``) used to batch a whole list of tasks (avoids N+1).
    """
    if subtasks_by_task is not None:
        return len(subtasks_by_task.get(task.id, []))
    return len(graph.contained_task_ids(db, task.id))


def _apply_containment(out, task, db, project_ids_by_task, parent_by_task, container_ids_by_task=None) -> None:
    """Populate the compat ``project_id``/``project_ids``/``container_ids``/``parent_id`` from edges."""
    out.project_ids = _membership_project_ids(task, db, project_ids_by_task)
    out.project_id = out.project_ids[0] if out.project_ids else None
    out.container_ids = _membership_container_ids(task, db, container_ids_by_task)
    out.parent_id = _parent_id(task, db, parent_by_task)


def enrich_task(
    task,
    db,
    dep_maps=None,
    labels_by_task=None,
    subtasks_by_task=None,
    project_ids_by_task=None,
    parent_by_task=None,
    container_ids_by_task=None,
) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = _subtask_count(task, db, subtasks_by_task)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    _apply_containment(out, task, db, project_ids_by_task, parent_by_task, container_ids_by_task)
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    rule = db.query(RecurrenceRule).filter(RecurrenceRule.template_task_id == task.id).first()
    out.recurrence = RecurrenceRuleOut.model_validate(rule) if rule else None
    return out


def enrich_task_as_dict(
    task,
    db,
    dep_maps=None,
    labels_by_task=None,
    subtasks_by_task=None,
    project_ids_by_task=None,
    parent_by_task=None,
    container_ids_by_task=None,
) -> dict:
    out = TaskOut.model_validate(task)
    out.labels = _task_labels(task, db, labels_by_task)
    out.subtask_count = _subtask_count(task, db, subtasks_by_task)
    out.comment_count = len(task.comments)
    out.blocked_by, out.blocking = _dependency_lists(task, db, dep_maps)
    out.pull_requests = [TaskPullRequestOut.model_validate(pr) for pr in task.pull_requests]
    _apply_containment(out, task, db, project_ids_by_task, parent_by_task, container_ids_by_task)
    if task.assigned_agent is not None:
        out.assigned_agent_name = task.assigned_agent.name
    return out.model_dump()


def enrich_project(project, db) -> ProjectOut:
    # Tasks belonging to this project come from graph ``contains`` edges (ADR-0032,
    # no primary): this naturally includes cross-project members.
    task_ids = graph.contained_task_ids(db, project.id)
    tasks = graph.task_views_for_ids(db, task_ids) if task_ids else []

    # Counts roll up the whole ``contains`` subtree, not just the direct children
    # listed above (ADR-0065): a task nested in a container under this project is
    # still this project's work. Identical to the old direct-children figure while
    # nothing is nested. Top-level tasks only — a parent task and its subtasks must
    # not be counted twice.
    stats = graph.container_subtree_stats(db, project.id)
    out = ProjectOut.model_validate(project)
    # Whether a PIN is set, never the hash (ADR-0059) — the owner's UI needs the
    # state to offer "remove", and model_validate would otherwise carry neither.
    out.share_pin_set = getattr(project, "share_pin_hash", None) is not None
    out.total_tasks = stats.total_tasks
    out.done_tasks = stats.done_tasks
    out.progress = stats.progress
    out.direct_task_count = stats.direct_task_count
    out.child_container_count = stats.child_container_count

    # Batch-load dependency, label, subtask and containment edges once for all tasks.
    task_ids = [t.id for t in tasks]
    dep_maps = graph.dependency_maps(db, task_ids)
    labels_by_task = graph.labels_map(db, task_ids)
    subtasks_by_task = graph.child_task_ids_map(db, task_ids)
    project_ids_by_task = graph.project_ids_map(db, task_ids)
    container_ids_by_task = graph.container_ids_map(db, task_ids)
    parent_by_task = graph.parent_task_map(db, task_ids)
    out.tasks = [
        enrich_task(
            t,
            db,
            dep_maps,
            labels_by_task,
            subtasks_by_task,
            project_ids_by_task,
            parent_by_task,
            container_ids_by_task,
        )
        for t in tasks
    ]

    out.labels = [LabelOut.model_validate(lb) for lb in graph.labels_in_project(db, project.id)]

    enriched_cycles = []
    for cycle in graph.cycles_in_project(db, project.id):
        tasks = graph.tasks_in_cycle(db, cycle.id)
        task_ids = [t.id for t in tasks]
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

    return out


def container_summary(node, db) -> ContainerSummary:
    """One container's subtree rollup in the shape both API surfaces serve (ADR-0065)."""
    stats = graph.container_subtree_stats(db, node.id)
    return ContainerSummary(
        id=node.id,
        type=node.type,
        title=node.title,
        status=node.status,
        total_tasks=stats.total_tasks,
        done_tasks=stats.done_tasks,
        progress=stats.progress,
        direct_task_count=stats.direct_task_count,
        child_container_count=stats.child_container_count,
    )


def enrich_container_subtree(node, db, *, visible=None) -> ContainerSubtree:
    """A container's rollup plus its direct child containers, each rolled up (ADR-0065).

    ``visible`` is an optional predicate applied to the children: the external API
    passes its project-scope check so a restricted key is not handed the titles of
    containers it may not read. The parent's own rollup is a property of the parent
    and is not filtered.
    """
    children = [db_node for db_node in _child_container_nodes(node, db) if visible is None or visible(db_node)]
    return ContainerSubtree(
        **container_summary(node, db).model_dump(),
        children=[container_summary(child, db) for child in children],
    )


def _child_container_nodes(node, db) -> list:
    from app.models import Node

    nodes = (db.get(Node, cid) for cid in graph.child_container_ids(db, node.id))
    return [n for n in nodes if n is not None]
