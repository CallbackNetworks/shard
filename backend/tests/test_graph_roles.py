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


def _custom_container_with_task(db, sample_project):
    """A task filed under BOTH a real project and a custom container type."""
    db.add(NodeType(key="workspace", label="Workspace", is_container=True))
    db.commit()
    ws = graph.create_node(db, "workspace", title="My workspace")
    task = graph.create_task(db, title="T", project_id=sample_project.id)
    graph.add_edge(db, ws.id, task.id, graph.REL_CONTAINS)
    db.commit()
    return ws, task


def test_member_project_ids_stays_literal_project(db, sample_project):
    # A custom container id must NOT leak into the compat project set (ADR-0034).
    ws, task = _custom_container_with_task(db, sample_project)
    assert graph.member_project_ids(db, task.id) == [sample_project.id]
    assert ws.id not in graph.member_project_ids(db, task.id)


def test_member_container_ids_is_generic_superset(db, sample_project):
    ws, task = _custom_container_with_task(db, sample_project)
    containers = set(graph.member_container_ids(db, task.id))
    assert containers == {sample_project.id, ws.id}


def test_ids_maps_split_project_vs_container(db, sample_project):
    ws, task = _custom_container_with_task(db, sample_project)
    assert graph.project_ids_map(db, [task.id])[task.id] == [sample_project.id]
    assert set(graph.container_ids_map(db, [task.id])[task.id]) == {sample_project.id, ws.id}


def test_enrich_task_exposes_container_ids_without_leaking(db, sample_project):
    from app.services.enrichment import enrich_task

    ws, task = _custom_container_with_task(db, sample_project)
    out = enrich_task(graph.get_task(db, task.id), db)
    assert out.project_ids == [sample_project.id]
    assert out.project_id == sample_project.id
    assert set(out.container_ids) == {sample_project.id, ws.id}


def test_task_only_in_custom_container_reads_unfiled_projectwise(db):
    # A task under only a custom container has no literal project -> compat fields empty
    # (frontend treats it as unfiled, never 404s), but container_ids still exposes it.
    db.add(NodeType(key="workspace", label="Workspace", is_container=True))
    db.commit()
    ws = graph.create_node(db, "workspace", title="WS")
    task = graph.create_task(db, title="orphan-of-project")
    graph.add_edge(db, ws.id, task.id, graph.REL_CONTAINS)
    db.commit()
    from app.services.enrichment import enrich_task

    out = enrich_task(graph.get_task(db, task.id), db)
    assert out.project_ids == []
    assert out.project_id is None
    assert out.container_ids == [ws.id]


def test_delete_project_keeps_task_alive_under_custom_container(db, sample_project):
    # Delete-orphan uses the generic container set: a task also held by a custom
    # container survives its project's deletion (ADR-0034).
    ws, task = _custom_container_with_task(db, sample_project)
    graph.delete_project_and_tasks(db, graph.get_project(db, sample_project.id))
    db.commit()
    surviving = graph.get_task(db, task.id)
    assert surviving is not None
    assert graph.member_container_ids(db, task.id) == [ws.id]


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
