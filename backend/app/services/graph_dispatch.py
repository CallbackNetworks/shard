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

Roles are read from the ``node_types`` ``roles`` set (ADR-0040 stage 2) via
``graph.task_type_keys`` / ``graph.container_type_keys``.

``dispatch_edge_added`` / ``dispatch_edge_removed`` below apply the same idea to
relationships (ADR-0045): a ``labeled`` edge means the same thing whether it was
written through ``/api/projects/{p}/tasks/{t}/labels/{l}`` or through the generic
``/api/nodes/{id}/edges``, so the reaction is keyed by ``rel_type`` and the
endpoints' roles rather than by the route that happened to be called.
"""

from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph
from app.services.activity import log_activity
from app.services.notifier import fire_notifications, fire_project_notifications
from app.services.rules_engine import run_rules
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


async def _fire_project_event(db: Session, node: Node, event: str, *, source: str, actor: str | None) -> None:
    """Notify subscribers of a literal-project lifecycle event (ADR-0047).

    Scoped to the built-in project type rather than the container role: a custom
    container is not what a ``project.*`` subscriber asked for.
    """
    if node.type != graph.NODE_PROJECT:
        return
    project = graph.get_project(db, node.id)
    if project is not None:
        await fire_project_notifications(db, project, event, source=source, actor=actor)


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
    # Rules see every node, not only task-role ones (ADR-0049). The task branch above
    # already ran them from inside finalize_task_create.
    await run_rules(db, "node.created", node, {})
    db.commit()
    await _fire_project_event(db, node, "project.created", source=source, actor=actor)
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
    # Which fields actually moved, not which were submitted: a rule asking "when status
    # changed" must not fire for a PATCH that sent the same status back (ADR-0055).
    changed = sorted(k for k, v in changes.items() if getattr(node, k, None) != v)
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
    if changed:
        await run_rules(db, "node.updated", db.get(Node, node.id), {"changed": changed})
        db.commit()
    if changes.get("status") == "archived":
        await _fire_project_event(db, node, "project.archived", source=source, actor=actor)
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
        # Notify before the teardown: fire_notifications resolves the project from
        # the task, which is impossible once delete_task_tree has run.
        task = graph.get_task(db, node_id)
        if task is not None:
            await fire_notifications(db, task, "task.deleted", source=source, actor=actor)
            # Before the teardown, while the subject still exists. Every action but
            # fire_event is skipped visibly: writing to a node on its way out is a write
            # nobody will ever read (ADR-0055).
            await run_rules(db, "node.deleted", task, {})
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
    await run_rules(db, "node.deleted", node, {})
    # Container-role nodes (project/goal/custom) cascade their exclusively-owned tasks
    # and scoped labels/cycles (ADR-0043); other types just drop the node and its edges.
    # The edges that vanish with the node do not fire edge.removed: this event is the
    # one that covers them (ADR-0055).
    if node_type in graph.container_type_keys(db):
        graph.delete_container(db, node_id)
    else:
        graph.delete_node(db, node_id, actor=actor)
    db.commit()
    await ws_manager.broadcast("node.deleted", {"node_id": node_id, "type": node_type})


# ── Edge dispatch (ADR-0045) ─────────────────────────────────────────────────
# Relationship writes had the same defect nodes had before ADR-0040: the named
# sub-resources (labels, cycle assignment, dependencies, memberships) each fired
# their own ad-hoc subset of reactions, while the generic /nodes/{id}/edges
# surface fired none. Adding the same edge two different ways produced two
# different sets of side-effects, and three of the four named routes never
# broadcast at all, so a label added in one browser tab never reached another.


async def _sync_task_labels(db: Session, task_id: str) -> None:
    """Push a task's label set outward when it is linked to an external issue."""
    # Deferred import: issue_sync's router module imports this layer's siblings
    # at load time; same pattern as task_mutations.
    from app.routers.issue_sync import sync_labels_to_external

    task = graph.get_task(db, task_id)
    if task and task.external_provider:
        await sync_labels_to_external(task, db)


async def _sync_task_milestone(db: Session, task_id: str) -> None:
    """Mirror a task's cycle membership onto the external issue's milestone."""
    from app.routers.issue_sync import sync_task_milestone_to_external

    task = graph.get_task(db, task_id)
    if task and task.external_provider:
        await sync_task_milestone_to_external(task, db)


async def _broadcast_task_touched(db: Session, enabled: bool, *task_ids: str) -> None:
    """Tell listeners the given tasks changed shape, deduplicated."""
    if not enabled:
        return
    for task_id in dict.fromkeys(task_ids):
        await ws_manager.broadcast(
            "task.updated",
            {"task_id": task_id, "project_id": graph.project_id_of_task(db, task_id)},
        )


def _log_label_change(db: Session, task_id: str, label_id: str, *, added: bool, actor: str | None) -> None:
    """Record a label assignment in the activity feed."""
    task = graph.get_task(db, task_id)
    label = db.get(Node, label_id)
    if task is None or label is None:
        return
    verb = "added to" if added else "removed from"
    log_activity(
        db,
        "task.label_added" if added else "task.label_removed",
        project_id=graph.project_id_of_task(db, task_id),
        task_id=task_id,
        actor=actor,
        detail=f'Label "{label.title}" {verb} task "{task.title}"',
        meta={"label_id": label_id, "label_name": label.title},
    )


async def _run_edge_rules(db: Session, source_id: str, target_id: str, rel_type: str, *, added: bool) -> None:
    """Run the edge rules once for each end of the edge (ADR-0055).

    An edge is a fact about two nodes and either of them may want to react, so the
    subject is each endpoint in turn and ``edge_side`` says which one it is. Firing only
    for the source would make "when a task is linked into a container" inexpressible —
    ``contains`` runs container -> task, so the task is never the source.

    A rule with no conditions therefore runs twice for one edge. That is the price of
    the generalisation, and conditions (``has_role``, ``edge_side``) narrow it back down;
    a rule whose conditions do not match leaves nothing behind at all.
    """
    from app.services.rules_engine import EDGE_SIDE_SOURCE, EDGE_SIDE_TARGET, subject_for

    trigger = "edge.added" if added else "edge.removed"
    ends = ((source_id, target_id, EDGE_SIDE_SOURCE), (target_id, source_id, EDGE_SIDE_TARGET))
    for subject_id, other_id, side in ends:
        subject = subject_for(db, subject_id)
        if subject is None:
            continue
        other = db.get(Node, other_id)
        await run_rules(
            db,
            trigger,
            subject,
            {
                "edge_type": rel_type,
                "edge_side": side,
                "other_type": other.type if other is not None else None,
                "other_id": other_id,
            },
        )


async def _dispatch_edge(
    db: Session,
    source_id: str,
    target_id: str,
    rel_type: str,
    *,
    added: bool,
    actor: str | None,
    commit: bool,
    broadcast: bool,
    trigger_rules: bool,
) -> None:
    """Shared body for edge add/remove: same reactions, different activity verb.

    Activity is written first so it lands in the caller's transaction, then the
    single optional commit, then the out-of-transaction reactions (rules,
    outbound sync, broadcast).
    """
    target = db.get(Node, target_id)

    if rel_type == graph.REL_LABELED:
        # task -> label
        _log_label_change(db, source_id, target_id, added=added, actor=actor)
    elif rel_type == graph.REL_CONTAINS and target is not None and _has_task_role(db, target.type):
        # container -> task: a membership change is user-visible enough to earn
        # an activity entry of its own.
        log_activity(
            db,
            "task.membership_added" if added else "task.membership_removed",
            project_id=source_id,
            task_id=target_id,
            actor=actor or "api",
            detail=f"Task {'linked into' if added else 'unlinked from'} container {source_id}",
            meta={"container_id": source_id},
        )

    if commit:
        db.commit()

    if trigger_rules:
        await _run_edge_rules(db, source_id, target_id, rel_type, added=added)
        if commit:
            db.commit()

    if rel_type == graph.REL_LABELED:
        await _sync_task_labels(db, source_id)
        await _broadcast_task_touched(db, broadcast, source_id)
        return

    if rel_type == graph.REL_IN_CYCLE:
        # task -> cycle
        await _sync_task_milestone(db, source_id)
        await _broadcast_task_touched(db, broadcast, source_id)
        return

    if rel_type == graph.REL_DEPENDS_ON:
        # blocked task -> prerequisite task; both ends change their blocked/blocking view
        await _broadcast_task_touched(db, broadcast, source_id, target_id)
        return

    if rel_type == graph.REL_CONTAINS and target is not None and _has_task_role(db, target.type):
        await _broadcast_task_touched(db, broadcast, target_id)
        return

    if broadcast:
        await ws_manager.broadcast(
            "node.linked" if added else "node.unlinked",
            {"source_id": source_id, "target_id": target_id, "rel_type": rel_type},
        )


async def dispatch_edge_added(
    db: Session,
    source_id: str,
    target_id: str,
    rel_type: str,
    *,
    actor: str | None = None,
    commit: bool = True,
    broadcast: bool = True,
    trigger_rules: bool = True,
) -> None:
    """Fire the reactions for a newly added edge, keyed by ``rel_type``.

    The edge must already be written and flushed. With ``commit=False`` the
    caller owns the transaction (batch loops); reactions still run.
    ``broadcast=False`` suppresses the per-edge WebSocket event for callers that
    emit one aggregate event instead. ``trigger_rules=False`` is for edges a rule wrote:
    the activity entry and outbound sync still happen, but a rule must not trigger
    another rule (ADR-0048).
    """
    await _dispatch_edge(
        db,
        source_id,
        target_id,
        rel_type,
        added=True,
        actor=actor,
        commit=commit,
        broadcast=broadcast,
        trigger_rules=trigger_rules,
    )


async def dispatch_edge_removed(
    db: Session,
    source_id: str,
    target_id: str,
    rel_type: str,
    *,
    actor: str | None = None,
    commit: bool = True,
    broadcast: bool = True,
    trigger_rules: bool = True,
) -> None:
    """Fire the reactions for a removed edge, keyed by ``rel_type``."""
    await _dispatch_edge(
        db,
        source_id,
        target_id,
        rel_type,
        added=False,
        actor=actor,
        commit=commit,
        broadcast=broadcast,
        trigger_rules=trigger_rules,
    )
