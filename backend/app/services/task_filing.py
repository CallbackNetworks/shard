"""The unfiled bucket, for both doors (ADR-0092).

A task may legally reach zero project memberships (ADR-0032/0033). When it does it is not
lost — it is *unfiled*, and the UI has a bucket for exactly that. ``/api/v1`` had no such
concept: a task with no project is absent from ``/projects/{id}/tasks`` by definition, and
while ``GET /nodes?type=task`` would return it, nothing told an agent which of those tasks
had fallen out of every project.

That gap had a visible edge: the MCP prompt ``triage-inbox`` asks the model to review the
inbox, and there was no endpoint behind the idea. The prompt existed, the data did not.

Filing is the other half. An unfiled task's first ``contains`` edge cannot come from the
project-scoped membership route (that one requires a source project to move it out of), so
without this a caller could observe the bucket and not empty it.
"""

from sqlalchemy.orm import Session

from app.schemas import TaskOut
from app.services import graph
from app.services.enrichment import enrich_task
from app.services.errors import NotFound
from app.services.graph_dispatch import dispatch_edge_added


def list_unfiled(db: Session) -> list[TaskOut]:
    """Tasks belonging to no project at all, enriched like any other task."""
    ids = graph.unfiled_task_ids(db)
    if not ids:
        return []
    return [enrich_task(t, db) for t in graph.task_views_for_ids(db, ids)]


async def file_into_project(db: Session, task_id: str, project_id: str) -> TaskOut:
    """Give a task a project via a ``contains`` edge. Idempotent."""
    task = graph.get_task(db, task_id)
    if task is None:
        raise NotFound("Task not found")
    if graph.get_project(db, project_id) is None:
        raise NotFound("Project not found")
    graph.ensure_node(db, project_id, graph.NODE_PROJECT)
    graph.ensure_node(db, task_id, graph.NODE_TASK, title=task.title)
    graph.add_edge(db, project_id, task_id, graph.REL_CONTAINS)
    await dispatch_edge_added(db, project_id, task_id, graph.REL_CONTAINS, actor="api")
    return enrich_task(graph.get_task(db, task_id), db)
