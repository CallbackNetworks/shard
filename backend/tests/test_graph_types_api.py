"""Tests for the node/edge type registry REST API (ADR-0033 Phase A)."""

from app.services import graph


def test_list_node_types_includes_builtins(client):
    r = client.get("/api/graph-types/nodes")
    assert r.status_code == 200
    keys = {t["key"] for t in r.json()}
    assert {graph.NODE_TASK, graph.NODE_PROJECT} <= keys
    task = next(t for t in r.json() if t["key"] == graph.NODE_TASK)
    assert task["is_builtin"] is True


def test_list_edge_types_includes_builtins(client):
    r = client.get("/api/graph-types/edges")
    assert r.status_code == 200
    contains = next(t for t in r.json() if t["key"] == graph.REL_CONTAINS)
    assert contains["is_builtin"] is True
    assert contains["is_containment"] is True


def test_type_listings_carry_usage_counts(client):
    """ADR-0037: usage_count lets the UI show why a delete would 409."""
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    client.post("/api/nodes", json={"type": "topic", "title": "A"})
    a = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "C"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})

    topic = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "topic")
    assert topic["usage_count"] == 3
    contains = next(t for t in client.get("/api/graph-types/edges").json() if t["key"] == graph.REL_CONTAINS)
    assert contains["usage_count"] >= 1


def test_create_custom_node_type(client):
    r = client.post("/api/graph-types/nodes", json={"key": "Topic", "label": "Topic", "color": "#abcdef"})
    assert r.status_code == 201
    body = r.json()
    assert body["key"] == "topic"  # normalized to lowercase
    assert body["is_builtin"] is False

    # It now appears in the list.
    keys = {t["key"] for t in client.get("/api/graph-types/nodes").json()}
    assert "topic" in keys


def test_create_node_type_rejects_bad_key(client):
    r = client.post("/api/graph-types/nodes", json={"key": "has space", "label": "X"})
    assert r.status_code == 422


def test_create_node_type_conflict(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Again"})
    assert r.status_code == 409


def test_update_node_type(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.patch("/api/graph-types/nodes/topic", json={"label": "Subject"})
    assert r.status_code == 200
    assert r.json()["label"] == "Subject"


def test_cannot_delete_builtin_node_type(client):
    r = client.delete(f"/api/graph-types/nodes/{graph.NODE_TASK}")
    assert r.status_code == 400


def test_delete_custom_node_type(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.delete("/api/graph-types/nodes/topic")
    assert r.status_code == 204
    assert "topic" not in {t["key"] for t in client.get("/api/graph-types/nodes").json()}


def test_delete_node_type_in_use_conflict(client, db):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    graph.create_node(db, "topic", title="My topic")
    db.commit()
    r = client.delete("/api/graph-types/nodes/topic")
    assert r.status_code == 409


def test_create_custom_container_type(client):
    # ADR-0034/0040: the container role is user-settable on custom types via roles.
    r = client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "roles": ["container"]})
    assert r.status_code == 201
    assert r.json()["roles"] == ["container"]
    assert graph.NODE_PROJECT not in (r.json()["key"],)  # sanity: it's the custom key
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "workspace")
    assert "container" in listed["roles"]


def test_toggle_container_role_on_custom_type(client):
    client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace"})
    r = client.patch("/api/graph-types/nodes/workspace", json={"roles": ["container"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["container"]


def test_cannot_change_role_of_builtin_type(client):
    # Dropping project's container role would break compat project_ids (ADR-0034).
    r = client.patch(f"/api/graph-types/nodes/{graph.NODE_PROJECT}", json={"roles": ["shareable"]})
    assert r.status_code == 400
    # And it stays a container.
    proj = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == graph.NODE_PROJECT)
    assert "container" in proj["roles"]


def test_custom_type_can_opt_into_capabilities(client):
    # ADR-0039/0040: shareable/subscribable roles are settable on a custom type, so a
    # user "topic" gets the same share-facade / iCal capability as identity.
    r = client.post(
        "/api/graph-types/nodes",
        json={"key": "topic", "label": "Topic", "roles": ["shareable", "subscribable"]},
    )
    assert r.status_code == 201
    assert set(r.json()["roles"]) == {"shareable", "subscribable"}
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "topic")
    assert set(listed["roles"]) == {"shareable", "subscribable"}


def test_toggle_capability_on_custom_type(client):
    # Capabilities are set via the roles set on PATCH.
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    r = client.patch("/api/graph-types/nodes/topic", json={"roles": ["shareable"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["shareable"]


def test_custom_container_surfaces_in_container_ids_not_project_ids(client, db, sample_project):
    # End-to-end: a task under a user-defined container appears in container_ids but
    # never leaks into project_ids (ADR-0034), so the frontend won't 404.
    client.post("/api/graph-types/nodes", json={"key": "workspace", "label": "Workspace", "roles": ["container"]})
    ws = graph.create_node(db, "workspace", title="WS")
    task = client.post(f"/api/projects/{sample_project.id}/tasks", json={"title": "T"}).json()
    graph.add_edge(db, ws.id, task["id"], graph.REL_CONTAINS)
    db.commit()

    got = client.get(f"/api/projects/{sample_project.id}").json()
    enriched = next(t for t in got["tasks"] if t["id"] == task["id"])
    assert enriched["project_ids"] == [sample_project.id]
    assert ws.id not in enriched["project_ids"]
    assert set(enriched["container_ids"]) == {sample_project.id, ws.id}


def test_create_custom_task_like_type(client):
    # ADR-0035/0040: the task role is user-settable on custom types via roles.
    r = client.post("/api/graph-types/nodes", json={"key": "ticket", "label": "Ticket", "roles": ["task"]})
    assert r.status_code == 201
    assert r.json()["roles"] == ["task"]
    listed = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == "ticket")
    assert "task" in listed["roles"]


def test_toggle_task_like_role_on_custom_type(client):
    client.post("/api/graph-types/nodes", json={"key": "ticket", "label": "Ticket"})
    r = client.patch("/api/graph-types/nodes/ticket", json={"roles": ["task"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["task"]


def test_cannot_change_task_like_of_builtin_task(client):
    # Dropping the built-in task's role would break the enrichment pipeline (ADR-0035).
    r = client.patch(f"/api/graph-types/nodes/{graph.NODE_TASK}", json={"roles": []})
    assert r.status_code == 400
    task = next(t for t in client.get("/api/graph-types/nodes").json() if t["key"] == graph.NODE_TASK)
    assert "task" in task["roles"]


def test_create_and_delete_custom_edge_type(client):
    r = client.post("/api/graph-types/edges", json={"key": "blocks", "label": "Blocks"})
    assert r.status_code == 201
    assert r.json()["is_builtin"] is False
    assert client.delete("/api/graph-types/edges/blocks").status_code == 204


def test_cannot_delete_builtin_edge_type(client):
    r = client.delete(f"/api/graph-types/edges/{graph.REL_CONTAINS}")
    assert r.status_code == 400


def test_cannot_change_structural_flags_of_builtin_edge_type(client):
    # Flipping contains' is_containment would collapse the containment pipeline
    # (mirrors the built-in node-type role guard).
    r = client.patch(f"/api/graph-types/edges/{graph.REL_CONTAINS}", json={"is_containment": False})
    assert r.status_code == 400
    contains = next(t for t in client.get("/api/graph-types/edges").json() if t["key"] == graph.REL_CONTAINS)
    assert contains["is_containment"] is True
    # Label stays editable on built-ins.
    r = client.patch(f"/api/graph-types/edges/{graph.REL_CONTAINS}", json={"label": "Contains!"})
    assert r.status_code == 200
    assert r.json()["label"] == "Contains!"


def test_update_structural_flags_of_custom_edge_type(client):
    client.post("/api/graph-types/edges", json={"key": "groups", "label": "Groups"})
    r = client.patch("/api/graph-types/edges/groups", json={"is_containment": True})
    assert r.status_code == 200
    assert r.json()["is_containment"] is True
