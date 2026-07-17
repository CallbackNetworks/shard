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


def test_create_and_delete_custom_edge_type(client):
    r = client.post("/graph-types/edges", json={"key": "blocks", "label": "Blocks"})
    assert r.status_code == 201
    assert r.json()["is_builtin"] is False
    assert client.delete("/graph-types/edges/blocks").status_code == 204


def test_cannot_delete_builtin_edge_type(client):
    r = client.delete(f"/graph-types/edges/{graph.REL_CONTAINS}")
    assert r.status_code == 400
