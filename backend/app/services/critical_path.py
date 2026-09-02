"""
Critical path analysis for project task dependencies.

Computes earliest/latest start/finish times and identifies the critical path
(tasks with zero slack) through the dependency DAG.
"""

import logging
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph

logger = logging.getLogger(__name__)

DEFAULT_DURATION_MINUTES = 60


def compute_critical_path(db: Session, project_id: str) -> dict:
    """Compute the critical path through task dependencies for a project.

    Returns a dict with:
      - critical_path: ordered list of task IDs on the critical path
      - total_duration_minutes: total duration along the critical path
      - tasks: per-task timing info (title, duration, earliest_start, latest_start, slack)
      - error: set if a cycle is detected
    """
    # Query all still-open top-level tasks in the project (via contains edges).
    task_ids = graph.contained_task_ids(db, project_id)
    nodes = (
        db.query(Node)
        .filter(
            graph.task_type_filter(db),
            Node.id.in_(task_ids),
            graph.open_status_clause(),
            graph.top_level_task_filter(db),
        )
        .all()
        if task_ids
        else []
    )
    tasks = [graph.task_view(n, db) for n in nodes]

    if not tasks:
        return {"critical_path": [], "total_duration_minutes": 0, "tasks": {}}

    task_map = {t.id: t for t in tasks}
    task_ids = set(task_map.keys())

    # Dependency edges only among our active tasks (ADR-0032).
    blocked_by_map, _ = graph.dependency_maps(db, task_ids)

    # Build adjacency: predecessors[task_id] = set of tasks it depends on
    # successors[task_id] = set of tasks that depend on it
    predecessors: dict[str, set[str]] = defaultdict(set)
    successors: dict[str, set[str]] = defaultdict(set)
    in_degree: dict[str, int] = {tid: 0 for tid in task_ids}

    for tid in task_ids:
        # tid is blocked by each prerequisite; keep only edges inside the active set
        for prereq in blocked_by_map.get(tid, []):
            if prereq not in task_ids:
                continue
            predecessors[tid].add(prereq)
            successors[prereq].add(tid)
            in_degree[tid] += 1

    # Topological sort (Kahn's algorithm) — also detects cycles
    queue = deque([tid for tid in task_ids if in_degree[tid] == 0])
    topo_order: list[str] = []

    while queue:
        node = queue.popleft()
        topo_order.append(node)
        for succ in successors[node]:
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(topo_order) != len(task_ids):
        return {"error": "Dependency cycle detected", "critical_path": []}

    # Duration for each task
    duration: dict[str, int] = {}
    for tid in task_ids:
        t = task_map[tid]
        duration[tid] = t.time_estimate if t.time_estimate is not None else DEFAULT_DURATION_MINUTES

    # Forward pass: compute earliest start (ES) and earliest finish (EF)
    earliest_start: dict[str, int] = {}
    earliest_finish: dict[str, int] = {}

    for tid in topo_order:
        if predecessors[tid]:
            es = max(earliest_finish[pred] for pred in predecessors[tid])
        else:
            es = 0
        earliest_start[tid] = es
        earliest_finish[tid] = es + duration[tid]

    # Project total duration
    project_duration = max(earliest_finish.values()) if earliest_finish else 0

    # Backward pass: compute latest start (LS) and latest finish (LF)
    latest_finish: dict[str, int] = {}
    latest_start: dict[str, int] = {}

    for tid in reversed(topo_order):
        if successors[tid]:
            lf = min(latest_start[succ] for succ in successors[tid])
        else:
            lf = project_duration
        latest_finish[tid] = lf
        latest_start[tid] = lf - duration[tid]

    # Identify critical path tasks (slack == 0)
    task_info: dict[str, dict] = {}
    for tid in topo_order:
        slack = latest_start[tid] - earliest_start[tid]
        task_info[tid] = {
            "title": task_map[tid].title,
            "duration": duration[tid],
            "earliest_start": earliest_start[tid],
            "latest_start": latest_start[tid],
            "slack": slack,
        }

    # Build the critical path: tasks with zero slack, in topological order
    critical_tasks = [tid for tid in topo_order if task_info[tid]["slack"] == 0]

    total_duration = project_duration

    return {
        "critical_path": critical_tasks,
        "total_duration_minutes": total_duration,
        "tasks": task_info,
    }
