"""Role-driven domain-event dispatcher for graph node mutations (ADR-0040).

Problem this solves (ADR-0040, "problem one"): the generic graph write surface
(``POST``/``PATCH``/``DELETE`` ``/api/nodes``) used to be a *dumb write* — it
inserted/updated a ``Node`` (plus a ``GraphEvent`` provenance row) and returned,
skipping the domain reactions (outbound notifications, workflow rules, activity
log, WebSocket broadcast) that the dedicated routers fire. Same logical action,
different side-effects by URL: an agent could create a task and flip it to
``done`` through ``/api/nodes`` and no webhook fired — a silent downgrade (data
written, behaviour dropped, no error), the hardest kind of defect to trace.

The fix hangs the reactions on the *state transition*, keyed by the node's
roles, not on the endpoint. Any entry point that produces the same transition
gets the same behaviour. Task-role nodes reuse the unified task mutation
pipeline (ADR-0038: ``finalize_task_create`` / ``apply_task_update``) so a task
written through ``/api/nodes`` behaves exactly like one written through
``/api/projects/{id}/tasks``.

Roles are still read from the ``node_types`` capability booleans here (via
``graph.task_type_keys`` / ``graph.container_type_keys``). ADR-0040 stage 2
migrates those to a ``roles`` set; at that point ``_has_task_role`` becomes a
``has_role`` lookup with no change to the dispatch logic below.
"""

from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph
from app.services.activity import log_activity
from app.services.task_mutations import apply_task_update, finalize_task_create
from app.services.ws_manager import ws_manager


def _has_task_role(db: Session, node_type: str) -> bool:
    """Whether ``node_type`` plays the task role (built-in ``task`` + custom task-like)."""
    return node_type in graph.task_type_keys(db)


def _generic_scope(db: Session, node: Node) -> str | None:
    """Activity-feed scope id for a non-task node.

    Container-role nodes (projects, custom containers) land in their own feed via
    ``project_id`` so a project created through ``/api/nodes`` still shows up;
    other node types have no dedicated feed yet, so the id lives only in ``meta``.
    """
    return node.id if node.type in graph.container_type_keys(db) else None


async def dispatch_node_created(db: Session, node: Node, *, actor: str | None = None, source: str = "node") -> None:
    """Fire the creation reactions appropriate to a freshly created node's roles.

    Task-role nodes run the full ADR-0038 creation pipeline (activity + rules +
    notifications + broadcast); other types get a generic activity entry and
    broadcast. The node must already be flushed. Commits.
    """
    if _has_task_role(db, node.type):
        project_id = graph.project_id_of_task(db, node.id)
        await finalize_task_create(db, node.id, actor=actor, source=source, project_id=project_id)
        return
    log_activity(
        db,
        "node.created",
        project_id=_generic_scope(db, node),
        actor=actor,
        detail=f'{node.type} "{node.title}" created',
        meta={"type": node.type, "node_id": node.id},
    )
    db.commit()
    await ws_manager.broadcast("node.created", {"node_id": node.id, "type": node.type})


async def dispatch_node_updated(
    db: Session, node: Node, changes: dict, *, actor: str | None = None, source: str = "node"
) -> Node | None:
    """Apply field changes to a node and fire the reactions for its roles.

    Task-role nodes delegate to ``apply_task_update``, which both applies the
    changes and runs the status/priority/assignee reaction sequence (the missing
    piece that made ``/api/nodes`` a silent downgrade). Other types apply via
    ``graph.update_node`` and emit a generic activity entry + broadcast. Commits
    and returns the refreshed ``Node``.
    """
    if _has_task_role(db, node.type):
        await apply_task_update(db, node.id, changes, actor=actor, source=source)
        return db.get(Node, node.id)
    graph.update_node(db, node.id, **changes)
    log_activity(
        db,
        "node.updated",
        project_id=_generic_scope(db, node),
        actor=actor,
        detail=f'{node.type} "{node.title}" updated',
        meta={"type": node.type, "node_id": node.id, "fields": sorted(changes)},
    )
    db.commit()
    await ws_manager.broadcast("node.updated", {"node_id": node.id, "type": node.type})
    return db.get(Node, node.id)


async def dispatch_node_deleted(db: Session, node: Node, *, actor: str | None = None, source: str = "node") -> None:
    """Delete a node with the teardown + reactions appropriate to its roles.

    Task-role nodes go through ``delete_task_tree`` (cleans peripheral rows and
    subtask trees, unlinks cross-container survivors) and log/broadcast a
    ``task.deleted`` — the generic endpoint previously used a plain
    ``delete_node`` that leaked those rows. Other types use ``delete_node``. The
    node must still exist when called. Commits.
    """
    node_type = node.type
    node_id = node.id
    title = node.title
    if _has_task_role(db, node_type):
        project_id = graph.project_id_of_task(db, node_id)
        log_activity(
            db,
            "task.deleted",
            project_id=project_id,
            task_id=node_id,
            actor=actor,
            detail=f'Task "{title}" deleted',
            meta={"title": title},
        )
        graph.delete_task_tree(db, node_id)
        db.commit()
        await ws_manager.broadcast("task.deleted", {"project_id": project_id, "task_id": node_id})
        return
    scope = _generic_scope(db, node)
    log_activity(
        db,
        "node.deleted",
        project_id=scope,
        actor=actor,
        detail=f'{node_type} "{title}" deleted',
        meta={"type": node_type, "node_id": node_id},
    )
    graph.delete_node(db, node_id, actor=actor)
    db.commit()
    await ws_manager.broadcast("node.deleted", {"node_id": node_id, "type": node_type})
