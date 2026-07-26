"""Tests for registry-driven capability roles (ADR-0033 A5, ADR-0040).

The leaf helpers in graph.py no longer hardcode ``n.type == NODE_TASK/PROJECT``;
they read the ``container`` / ``task`` roles from the node_types registry's
``roles`` set. Built-in roles are seeded to match the previous behavior exactly.
"""

from app.models import Node, NodeType
from app.services import graph


def test_builtin_roles_seeded(db):
    assert db.get(NodeType, graph.NODE_PROJECT).has_role("container") is True
    assert db.get(NodeType, graph.NODE_TASK).has_role("task") is True
    # goal is a container too (ADR-0041): it groups projects/tasks via ``contains``.
    assert db.get(NodeType, graph.NODE_GOAL).has_role("container") is True
    # Others carry neither role.
    assert db.get(NodeType, graph.NODE_LABEL).has_role("container") is False
    assert db.get(NodeType, graph.NODE_LABEL).has_role("task") is False


def test_role_key_helpers(db):
    assert graph.container_type_keys(db) == {graph.NODE_PROJECT, graph.NODE_GOAL}
    assert graph.task_type_keys(db) == {graph.NODE_TASK}


def test_builtin_containment_unchanged(client, sample_project, db):
    # A task under a project resolves its project via the container role.
    task = client.post("/api/nodes", json={"type": "task", "container_id": sample_project.id, "title": "T"}).json()
    assert sample_project.id in graph.member_project_ids(db, task["id"])
    assert task["id"] in graph.contained_task_ids(db, sample_project.id)


def test_custom_task_like_type_participates(db):
    # Marking a custom type task-like makes the subtask helpers treat it as a task.
    db.add(NodeType(key="ticket", label="Ticket", roles=["task"]))
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
    db.add(NodeType(key="workspace", label="Workspace", roles=["container"]))
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
    db.add(NodeType(key="workspace", label="Workspace", roles=["container"]))
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
    graph.delete_container(db, sample_project.id)
    db.commit()
    surviving = graph.get_task(db, task.id)
    assert surviving is not None
    assert graph.member_container_ids(db, task.id) == [ws.id]


def _custom_task_node(db, sample_project):
    """A node of a user-defined task-like type, filed under a project (ADR-0035)."""
    db.add(NodeType(key="ticket", label="Ticket", roles=["task"]))
    db.commit()
    node = graph.create_node(db, "ticket", title="A ticket")
    graph.add_edge(db, sample_project.id, node.id, graph.REL_CONTAINS)
    db.commit()
    return node


def test_task_like_node_gets_callback_token_on_create(db):
    db.add(NodeType(key="ticket", label="Ticket", roles=["task"]))
    db.commit()
    node = graph.create_node(db, "ticket", title="T")
    db.commit()
    # A first-class task type's nodes get the full task data surface (ADR-0035).
    assert (node.data or {}).get("callback_token")


def test_task_like_node_loads_as_taskview(db, sample_project):
    node = _custom_task_node(db, sample_project)
    view = graph.get_task(db, node.id)
    assert view is not None
    assert view.type == "ticket"
    assert view.status == "todo"  # default applied like a real task
    assert view.callback_token


def test_task_like_node_enriches_in_project(db, sample_project):
    from app.services.enrichment import enrich_project

    node = _custom_task_node(db, sample_project)
    out = enrich_project(graph.get_project(db, sample_project.id), db)
    row = next((t for t in out.tasks if t.id == node.id), None)
    assert row is not None
    assert row.type == "ticket"
    assert row.callback_token
    assert row.project_ids == [sample_project.id]


def test_task_like_node_in_project_task_list_endpoint(client, db, sample_project):
    node = _custom_task_node(db, sample_project)
    r = client.get(f"/api/projects/{sample_project.id}/tasks")
    assert r.status_code == 200
    row = next((t for t in r.json() if t["id"] == node.id), None)
    assert row is not None
    assert row["type"] == "ticket"


def test_task_like_node_deleted_with_project(db, sample_project):
    from app.models import Node

    node = _custom_task_node(db, sample_project)
    graph.delete_container(db, sample_project.id)
    db.commit()
    assert graph.get_task(db, node.id) is None
    assert db.get(Node, node.id) is None


def test_node_type_out_exposes_roles(client):
    types = {t["key"]: t for t in client.get("/api/graph-types/nodes").json()}
    assert "container" in types[graph.NODE_PROJECT]["roles"]
    assert types[graph.NODE_TASK]["roles"] == ["task"]


def test_top_level_task_filter_uses_role(db, sample_project):
    # A top-level task (no task-like parent) passes the filter; a subtask does not.
    root = graph.create_task(db, title="root", project_id=sample_project.id)
    sub = graph.create_task(db, title="sub", project_id=sample_project.id, parent_id=root.id)
    db.commit()

    top_ids = {t.id for t in db.query(Node).filter(Node.type == "task", graph.top_level_task_filter(db)).all()}
    assert root.id in top_ids
    assert sub.id not in top_ids


# --- Roles set (ADR-0040) -----------------------------------------------------


def test_create_type_with_roles(client):
    # The graph-types API takes the canonical roles set (ADR-0040).
    r = client.post(
        "/api/graph-types/nodes",
        json={"key": "area", "label": "Area", "roles": ["container", "shareable"]},
    )
    assert r.status_code == 201
    assert set(r.json()["roles"]) == {"container", "shareable"}


def test_builtin_container_role_immutable_via_roles(client):
    # Dropping project's container role (sent as a roles set) is rejected — a built-in
    # traversal role is frozen (ADR-0034/0035).
    r = client.patch("/api/graph-types/nodes/project", json={"roles": ["shareable"]})
    assert r.status_code == 400


def test_builtin_capability_role_toggle_allowed(client):
    # A cross-cutting capability (not container/task) may be toggled on a built-in:
    # identity keeps its shareable role but drops subscribable.
    r = client.patch("/api/graph-types/nodes/identity", json={"roles": ["shareable"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["shareable"]


def test_organization_user_defined_type_plays_all_roles(client, db):
    """ADR-0040 acid test: an ``organization`` defined purely as data (a roles set)
    participates in container/share/subscribe traversal with zero code special-casing.

    This is the forcing use-case for the role model — a container above identity —
    proving capability-typing works without promoting the type to a built-in.
    """
    r = client.post(
        "/api/graph-types/nodes",
        json={"key": "organization", "label": "Organization", "roles": ["container", "shareable", "subscribable"]},
    )
    assert r.status_code == 201
    assert set(r.json()["roles"]) == {"container", "shareable", "subscribable"}

    # Role-driven registry helpers pick it up with no hardcoding.
    assert "organization" in graph.container_type_keys(db)
    assert "organization" in graph.shareable_type_keys(db)
    assert "organization" in graph.subscribable_type_keys(db)
    assert graph.has_role(db, "organization", "container")

    # Container role: a task filed under the org lists as a contained task.
    org = client.post("/api/nodes", json={"type": "organization", "title": "Acme"}).json()
    task = client.post("/api/nodes", json={"type": "task", "title": "org task"}).json()
    client.post(f"/api/nodes/{org['id']}/edges", json={"target_id": task["id"], "rel_type": "contains"})
    contained = client.get(f"/api/nodes/{org['id']}/contained-tasks").json()
    assert [t["title"] for t in contained] == ["org task"]

    # Shareable role: the generic share facade mints a token that resolves publicly.
    token = client.post(f"/api/nodes/{org['id']}/share/rotate-token").json()["share_token"]
    assert client.get(f"/share/n/{token}").status_code == 200
