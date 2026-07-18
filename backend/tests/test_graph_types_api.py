"""Tests for the node/edge type registry REST API (ADR-0033 Phase A)."""

from app.services import graph


def test_list_node_types_includes_builtins(client):
    r = client.get("/graph-types/nodes")
    assert r.status_code == 200
    keys = {t["key"] for t in r.json()}
    assert {graph.NODE_TASK, graph.NODE_PROJECT} <= keys
    task = next(t for t in r.json() if t["key"] == graph.NODE_TASK)
    assert task["is_builtin"] is True


def test_list_edge_types_includes_builtins(client):
    r = client.get("/graph-types/edges")
    assert r.status_code == 200
    contains = next(t for t in r.json() if t["key"] == graph.REL_CONTAINS)
    assert contains["is_builtin"] is True
    assert contains["is_containment"] is True


def test_create_custom_node_type(client):
    r = client.post("/graph-types/nodes", json={"key": "Topic", "label": "Topic", "color": "#abcdef"})
    assert r.status_code == 201
    body = r.json()
    assert body["key"] == "topic"  # normalized to lowercase
    assert body["is_builtin"] is False

    # It now appears in the list.
    keys = {t["key"] for t in client.get("/graph-types/nodes").json()}
    assert "topic" in keys


def test_create_node_type_rejects_bad_key(client):
    r = client.post("/graph-types/nodes", json={"key": "has space", "label": "X"})
    assert r.status_code == 422


def test_create_node_type_conflict(client):
    client.post("/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.post("/graph-types/nodes", json={"key": "topic", "label": "Again"})
    assert r.status_code == 409


def test_update_node_type(client):
    client.post("/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.patch("/graph-types/nodes/topic", json={"label": "Subject"})
    assert r.status_code == 200
    assert r.json()["label"] == "Subject"


def test_cannot_delete_builtin_node_type(client):
    r = client.delete(f"/graph-types/nodes/{graph.NODE_TASK}")
    assert r.status_code == 400


def test_delete_custom_node_type(client):
    client.post("/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.delete("/graph-types/nodes/topic")
    assert r.status_code == 204
    assert "topic" not in {t["key"] for t in client.get("/graph-types/nodes").json()}


def test_delete_node_type_in_use_conflict(client, db):
    client.post("/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    graph.create_node(db, "topic", title="My topic")
    db.commit()
    r = client.delete("/graph-types/nodes/topic")
    assert r.status_code == 409


def test_create_custom_container_type(client):
    # ADR-0034: is_container is now user-settable on custom types.
    r = client.post("/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "is_container": True})
    assert r.status_code == 201
    assert r.json()["is_container"] is True
    assert graph.NODE_PROJECT not in (r.json()["key"],)  # sanity: it's the custom key
    listed = next(t for t in client.get("/graph-types/nodes").json() if t["key"] == "workspace")
    assert listed["is_container"] is True


def test_toggle_container_role_on_custom_type(client):
    client.post("/graph-types/nodes", json={"key": "workspace", "label": "Workspace"})
    r = client.patch("/graph-types/nodes/workspace", json={"is_container": True})
    assert r.status_code == 200
    assert r.json()["is_container"] is True


def test_cannot_change_role_of_builtin_type(client):
    # Flipping project's is_container off would break compat project_ids (ADR-0034).
    r = client.patch(f"/graph-types/nodes/{graph.NODE_PROJECT}", json={"is_container": False})
    assert r.status_code == 400
    # And it stays a container.
    proj = next(t for t in client.get("/graph-types/nodes").json() if t["key"] == graph.NODE_PROJECT)
    assert proj["is_container"] is True


def test_custom_container_surfaces_in_container_ids_not_project_ids(client, db, sample_project):
    # End-to-end: a task under a user-defined container appears in container_ids but
    # never leaks into project_ids (ADR-0034), so the frontend won't 404.
    client.post("/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "is_container": True})
    ws = graph.create_node(db, "workspace", title="WS")
    task = client.post(f"/projects/{sample_project.id}/tasks", json={"title": "T"}).json()
    graph.add_edge(db, ws.id, task["id"], graph.REL_CONTAINS)
    db.commit()

    got = client.get(f"/projects/{sample_project.id}").json()
    enriched = next(t for t in got["tasks"] if t["id"] == task["id"])
    assert enriched["project_ids"] == [sample_project.id]
    assert ws.id not in enriched["project_ids"]
    assert set(enriched["container_ids"]) == {sample_project.id, ws.id}


def test_create_and_delete_custom_edge_type(client):
    r = client.post("/graph-types/edges", json={"key": "blocks", "label": "Blocks"})
    assert r.status_code == 201
    assert r.json()["is_builtin"] is False
    assert client.delete("/graph-types/edges/blocks").status_code == 204


def test_cannot_delete_builtin_edge_type(client):
    r = client.delete(f"/graph-types/edges/{graph.REL_CONTAINS}")
    assert r.status_code == 400
