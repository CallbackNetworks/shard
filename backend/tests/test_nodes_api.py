"""Tests for the generic node/edge API (ADR-0033 Phase A)."""

import pytest

from app.services import graph


@pytest.fixture()
def topic_type(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    return "topic"


def test_create_custom_node(client, topic_type):
    r = client.post("/api/nodes", json={"type": "topic", "title": "Roadmap", "data": {"owner": "me"}})
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == "topic"
    assert body["title"] == "Roadmap"
    assert body["data"] == {"owner": "me"}
    assert body["id"]


def test_create_node_unknown_type(client):
    r = client.post("/api/nodes", json={"type": "nope", "title": "x"})
    assert r.status_code == 422


def test_builtin_type_creatable_via_generic_api(client):
    # ADR-0033 Phase B is complete and Phase C removed the entity-backed guard:
    # every built-in type is node-only, so the generic /nodes API accepts them.
    # ``project`` — the last former entity-backed type — is creatable here.
    r = client.post("/api/nodes", json={"type": graph.NODE_PROJECT, "title": "x"})
    assert r.status_code == 201
    assert r.json()["type"] == graph.NODE_PROJECT


def test_get_and_list_nodes(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    client.post("/api/nodes", json={"type": "topic", "title": "B"})

    got = client.get(f"/api/nodes/{a['id']}")
    assert got.status_code == 200
    assert got.json()["title"] == "A"

    listed = client.get("/api/nodes", params={"type": "topic"})
    assert {n["title"] for n in listed.json()} == {"A", "B"}


def test_update_node(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    r = client.patch(f"/api/nodes/{a['id']}", json={"title": "A2", "data": {"k": 1}})
    assert r.status_code == 200
    assert r.json()["title"] == "A2"
    assert r.json()["data"] == {"k": 1}


def test_update_node_allows_project(client, sample_project):
    # Project is node-only (ADR-0033 B6): the generic update endpoint accepts it.
    r = client.patch(f"/api/nodes/{sample_project.id}", json={"title": "x"})
    assert r.status_code == 200
    assert r.json()["title"] == "x"


def test_delete_node_clears_edges(client, topic_type, db):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})

    assert client.delete(f"/api/nodes/{a['id']}").status_code == 204
    # No dangling edge left touching the deleted node.
    from app.models import Edge

    assert db.query(Edge).filter((Edge.source_id == a["id"]) | (Edge.target_id == a["id"])).count() == 0


def test_delete_node_allows_project(client, sample_project):
    # Project is node-only (ADR-0033 B6): the generic delete endpoint accepts it.
    r = client.delete(f"/api/nodes/{sample_project.id}")
    assert r.status_code == 204


def test_attach_and_list_edges(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    r = client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})
    assert r.status_code == 201
    assert r.json()["rel_type"] == "contains"

    edges = client.get(f"/api/nodes/{a['id']}/edges").json()
    assert len(edges) == 1
    assert edges[0]["target_id"] == b["id"]


def test_edge_listing_embeds_node_summaries(client, topic_type, sample_project):
    """ADR-0037: edge listing embeds both endpoints so clients need no N+1 lookups."""
    topic = client.post("/api/nodes", json={"type": "topic", "title": "Q3"}).json()
    client.post(f"/api/nodes/{topic['id']}/edges", json={"target_id": sample_project.id, "rel_type": "contains"})

    edges = client.get(f"/api/nodes/{topic['id']}/edges").json()
    assert len(edges) == 1
    assert edges[0]["source"] == {"id": topic["id"], "type": "topic", "title": "Q3", "status": None}
    assert edges[0]["target"]["id"] == sample_project.id
    assert edges[0]["target"]["type"] == "project"
    assert edges[0]["target"]["title"]


def test_contained_tasks_for_custom_container(client, sample_project, db):
    """ADR-0037: a custom container lists its contained tasks enriched like a project."""
    from tests.factories import make_task

    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "is_container": True})
    task = make_task(db, project_id=sample_project.id, title="In area")
    db.commit()
    area = client.post("/api/nodes", json={"type": "area", "title": "Q3"}).json()
    client.post(f"/api/nodes/{area['id']}/edges", json={"target_id": task.id, "rel_type": "contains"})

    r = client.get(f"/api/nodes/{area['id']}/contained-tasks")
    assert r.status_code == 200
    body = r.json()
    assert [t["title"] for t in body] == ["In area"]
    # Enriched shape: compat project fields stay literal-project (ADR-0034);
    # the custom container shows up only in container_ids.
    assert body[0]["project_ids"] == [sample_project.id]
    assert set(body[0]["container_ids"]) == {sample_project.id, area["id"]}


def test_contained_tasks_unknown_node(client):
    r = client.get("/api/nodes/nope/contained-tasks")
    assert r.status_code == 404


def test_list_nodes_title_query(client, topic_type):
    client.post("/api/nodes", json={"type": "topic", "title": "Research Alpha"})
    client.post("/api/nodes", json={"type": "topic", "title": "Beta"})

    hits = client.get("/api/nodes", params={"type": "topic", "query": "alpha"}).json()
    assert [n["title"] for n in hits] == ["Research Alpha"]

    # Query works across types too (no type filter).
    hits = client.get("/api/nodes", params={"query": "research alp"}).json()
    assert any(n["title"] == "Research Alpha" for n in hits)


def test_attach_custom_node_contains_project(client, topic_type, sample_project):
    """Free-form containment: a custom topic node may contain a built-in project."""
    topic = client.post("/api/nodes", json={"type": "topic", "title": "Q3"}).json()
    r = client.post(
        f"/api/nodes/{topic['id']}/edges",
        json={"target_id": sample_project.id, "rel_type": "contains"},
    )
    assert r.status_code == 201


def test_attach_edge_unknown_rel_type(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    r = client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "bogus"})
    assert r.status_code == 422


def test_attach_contains_cycle_rejected(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})
    # b contains a would close a loop.
    r = client.post(f"/api/nodes/{b['id']}/edges", json={"target_id": a["id"], "rel_type": "contains"})
    assert r.status_code == 400


def test_detach_edge(client, topic_type):
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})
    r = client.delete(f"/api/nodes/{a['id']}/edges", params={"target_id": b["id"], "rel_type": "contains"})
    assert r.status_code == 204
    assert client.get(f"/api/nodes/{a['id']}/edges").json() == []
