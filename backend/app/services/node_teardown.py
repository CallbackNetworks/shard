"""What else dies with a node (ADR-0131).

``delete_node`` removed the node and every edge touching it, and nothing else. That was
the whole teardown for every type except task, where ``_delete_task_node`` had grown a
hand-written list of five peripheral tables — the only place in the codebase that knew
side rows existed at all.

So deleting a *container* left every row filed under it behind. Measured on a fresh
database, deleting one project stranded eight kinds of row at once: the project's guest
notes, its saved filters, its task templates, its notifications (including ones pointing
at tasks the same delete had just removed), its outbound integrations, its share-page
chat log and its workflow rules. None of it fails loudly. A notification survives as a
bell entry linking to a 404; a template survives in the global template list, which is
unscoped by default, so it is simply there forever.

The referential story was inconsistent in the same shape: the columns naming a *task*
(``comments.task_id``, ``attachments.task_id``, …) carry a real ``ForeignKey(ondelete=
"CASCADE")``, and the columns naming a *container* (``integrations.project_id``,
``saved_filters.project_id``, …) are bare ``String(36)`` with no constraint at all. SQLite
does not enforce the former without ``PRAGMA foreign_keys=ON``, so neither half was
actually enforced anywhere — which is why the cleanup is explicit here rather than
delegated to the database, exactly as ``_delete_task_node`` reasoned.

**Belonging, not history.** ``activity_logs`` and ``graph_events`` name nodes too and are
deliberately absent: they record that something *happened*, and ADR-0073 already settled
that retiring a subject must not retire its history. ``api_keys.container_id`` is absent
for a different reason — a credential is not a side row, and a container-scoped key whose
container is gone fails closed (``_container_ids_for`` cannot match it), so the safe
outcome is already the one you get. Deleting somebody's key as a side effect of deleting
a project would be the surprising half of that trade.
"""

import os
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.models import (
    ActivityWatch,
    Attachment,
    Comment,
    Integration,
    Notification,
    RecurrenceRule,
    SavedFilter,
    ShareChatLog,
    TaskPullRequest,
    TaskTemplate,
    WebhookDelivery,
    WebhookEvent,
    WorkflowRule,
)

# (model, column) pairs whose rows belong to the node the column names. Every column here
# holds a ``nodes.id`` — the pairs are listed rather than derived because "names a node"
# and "belongs to that node" are different claims, and only the second one may delete.
_OWNED_BY_NODE: list[tuple[type, Callable]] = [
    (Comment, lambda m: m.task_id),
    (Comment, lambda m: m.project_id),
    (Attachment, lambda m: m.task_id),
    (Attachment, lambda m: m.project_id),
    (TaskPullRequest, lambda m: m.task_id),
    (WebhookEvent, lambda m: m.task_id),
    (RecurrenceRule, lambda m: m.template_task_id),
    (Notification, lambda m: m.task_id),
    (Notification, lambda m: m.project_id),
    (ShareChatLog, lambda m: m.node_id),
    (SavedFilter, lambda m: m.project_id),
    (TaskTemplate, lambda m: m.project_id),
    (WorkflowRule, lambda m: m.project_id),
]


def purge_side_rows(db: Session, node_id: str) -> None:
    """Delete every row that belongs to this node. Flushes; does not commit.

    Called from ``graph.delete_node`` so it reaches every type through the one delete,
    rather than only the type whose delete happened to have been written by hand.
    """
    # Files first: the row is the only record of where the blob lives, so dropping it
    # first would leak the file with nothing left pointing at it.
    for column in (Attachment.task_id, Attachment.project_id):
        for att in db.query(Attachment).filter(column == node_id).all():
            try:
                os.remove(att.storage_path)
            except OSError:
                pass  # already gone, or never written — the row still goes

    # An integration takes its delivery log with it: the log carries that integration's
    # own request headers, and ADR-0085 made those a second path out for its credentials.
    doomed = [i.id for i in db.query(Integration).filter(Integration.project_id == node_id).all()]
    if doomed:
        db.query(WebhookDelivery).filter(WebhookDelivery.integration_id.in_(doomed)).delete(synchronize_session=False)
        db.query(Integration).filter(Integration.id.in_(doomed)).delete(synchronize_session=False)

    for model, column in _OWNED_BY_NODE:
        db.query(model).filter(column(model) == node_id).delete(synchronize_session=False)

    # A watch is registered against one node (ADR-0105); ``kind="node_type"`` watches a
    # type and has no target_id to match.
    db.query(ActivityWatch).filter(ActivityWatch.kind == "node", ActivityWatch.target_id == node_id).delete(
        synchronize_session=False
    )
    db.flush()
