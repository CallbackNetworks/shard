"""Tests for registry-driven traversal roles (ADR-0033 A5).

The leaf helpers in graph.py no longer hardcode ``n.type == NODE_TASK/PROJECT``;
they read the ``is_container`` / ``is_task_like`` roles from the node_types
registry. Built-in roles are seeded to match the previous behavior exactly.
"""

from app.models import Node, NodeType
from app.services import graph


def test_builtin_roles_seeded(db):
    assert db.get(NodeType, graph.NODE_PROJECT).is_container is True
    assert db.get(NodeType, graph.NODE_TASK).is_task_like is True
    # Others carry neither role.
    assert db.get(NodeType, graph.NODE_LABEL).is_container is False
    assert db.get(NodeType, graph.NODE_LABEL).is_task_like is False


def test_role_key_helpers(db):
    assert graph.container_type_keys(db) == {graph.NODE_PROJECT}
    assert graph.task_type_keys(db) == {graph.NODE_TASK}


def test_builtin_containment_unchanged(client, sample_project, db):
    # A task under a project resolves its project via the container role.
    task = client.post(f"/projects/{sample_project.id}/tasks", json={"title": "T"}).json()
    assert sample_project.id in graph.member_project_ids(db, task["id"])
    assert task["id"] in graph.contained_task_ids(db, sample_project.id)


def test_custom_task_like_type_participates(db):
    # Marking a custom type task-like makes the subtask helpers treat it as a task.
    db.add(NodeType(key="ticket", label="Ticket", is_task_like=True))
    db.commit()
    assert "ticket" in graph.task_type_keys(db)

    parent = graph.create_node(db, "ticket", title="Parent ticket")
    child = graph.create_node(db, "ticket", title="Child ticket")
    graph.add_edge(db, parent.id, child.id, graph.REL_CONTAINS)
    db.commit()

    # child has an incoming contains edge from a task-like node -> counted a subtask
    assert graph.subtask_ids_among(db, [parent.id, child.id]) == {child.id}


def test_non_task_like_custom_type_not_a_subtask(db):
    db.add(NodeType(key="topic", label="Topic"))  # neither role
    db.commit()
    parent = graph.create_node(db, "topic", title="Topic")
    child = graph.create_node(db, "topic", title="Child topic")
    graph.add_edge(db, parent.id, child.id, graph.REL_CONTAINS)
    db.commit()
    # parent is not task-like, so child is not a "subtask" in the task sense.
    assert graph.subtask_ids_among(db, [parent.id, child.id]) == set()


def test_node_type_out_exposes_roles(client):
    types = {t["key"]: t for t in client.get("/graph-types/nodes").json()}
    assert types[graph.NODE_PROJECT]["is_container"] is True
    assert types[graph.NODE_TASK]["is_task_like"] is True


def test_top_level_task_filter_uses_role(db, sample_project):
    # A top-level task (no task-like parent) passes the filter; a subtask does not.
    root = graph.create_task(db, title="root", project_id=sample_project.id)
    sub = graph.create_task(db, title="sub", project_id=sample_project.id, parent_id=root.id)
    db.commit()

    top_ids = {t.id for t in db.query(Node).filter(Node.type == "task", graph.top_level_task_filter()).all()}
    assert root.id in top_ids
    assert sub.id not in top_ids
