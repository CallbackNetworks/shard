"""Pushing a task outward as a new GitHub/GitLab issue, for both doors (ADR-0092).

Two-way issue sync has always been agent-reachable in one direction only: an issue arriving
from outside became a task, and every subsequent state change flowed both ways — but the act
that *starts* the relationship from this side, "make an issue out of this task", was an
internal route, so an agent could plan work here and never publish it where the humans and
the CI can see it.

The sync machinery itself still lives in ``routers/issue_sync`` (866 lines of provider
clients and payload mapping). This module is deliberately only the door in front of it: it
loads the subjects, refuses through ``ServiceError`` so both routers render the refusal the
same way (ADR-0085), and delegates. Moving the rest is a separate change with no user-facing
question in it.
"""

from sqlalchemy.orm import Session

from app.services import graph
from app.services.errors import Invalid, NotFound

PROVIDERS = ("github", "gitlab")


async def create_from_task(db: Session, project_id: str, task_id: str, provider: str | None = None):
    """Create an external issue from a task and link the two.

    ``provider`` is normally omitted and detected from the project's repo URL; pass it only
    when the URL is ambiguous. The task becomes the source of truth for the new issue, and
    afterwards the ordinary two-way sync applies.
    """
    # Imported here rather than at module scope: the sync module is a router that imports
    # services, and the top-level cycle would only exist to save one lookup.
    from app.routers.issue_sync import create_external_issue_from_task

    if provider and provider not in PROVIDERS:
        raise Invalid("provider must be 'github' or 'gitlab'")

    project = graph.get_project(db, project_id)
    if project is None:
        raise NotFound("Project not found")
    task = graph.get_task(db, task_id)
    if task is None or task_id not in graph.contained_task_ids(db, project_id):
        raise NotFound("Task not found")

    return await create_external_issue_from_task(task, project, db, provider)
