"""Test object factories for the node-only graph model (ADR-0033).

``Task`` was collapsed into ``Node(type="task")`` (Phase B, B5): there is no
``Task`` ORM class to construct anymore. ``make_task`` recreates the ergonomics of
the old ``Task(**kwargs)`` construction — it creates the task node plus its
``contains`` edges and returns the persisted ``Node`` so existing ``db.add(t)`` /
``db.refresh(t)`` calls stay valid (no-ops on an already-persistent row).

Hot columns (title/status/priority/start_date/due_date/position/is_pinned/
created_at/updated_at) are real ``Node`` attributes; non-hot fields live in
``node.data``. When a test needs the full task surface (description, assignee,
callback_token, ...), read it via ``graph.get_task(db, node.id)``.
"""

from app.models import Node
from app.services import graph

_VIEW_ATTRS = (
    "description",
    "assignee",
    "callback_token",
    "webhook_secret",
    "assigned_agent_key_id",
    "reminder_sent_at",
    "time_estimate",
    "time_spent",
    "progress_pct",
    "agent_notes",
    "external_provider",
    "external_id",
    "external_url",
    "external_repo",
)


def make_task(db, **kwargs) -> Node:
    """Create a task node with old ``Task(**kwargs)`` ergonomics; return the Node.

    The returned ``Node`` is decorated with the task's non-hot ``data`` fields as
    plain read attributes (description/assignee/callback_token/... ) so tests that
    read them off the constructed object keep working. These decorations are read
    snapshots, not columns — mutate task fields through ``graph.update_task``.
    """
    view = graph.create_task(db, **kwargs)
    node = db.get(Node, view.id)
    for attr in _VIEW_ATTRS:
        object.__setattr__(node, attr, getattr(view, attr))
    return node


def find_task_by_external_id(db, external_id):
    """Test helper: locate a task node by its ``external_id`` (stored in node.data)."""
    for node in db.query(Node).filter(Node.type == graph.NODE_TASK).all():
        if (node.data or {}).get("external_id") == external_id:
            return graph.task_view(node, db)
    return None


def find_task_by_title(db, title):
    """Test helper: return a full ``TaskView`` for the first task node with this title."""
    node = db.query(Node).filter(Node.type == graph.NODE_TASK, Node.title == title).first()
    return graph.task_view(node, db) if node is not None else None
