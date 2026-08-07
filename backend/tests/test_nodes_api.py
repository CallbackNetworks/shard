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

    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "roles": ["container"]})
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


def test_graph_map_slice(client, topic_type, sample_project, db):
    """ADR-0037: /graph/map returns a light {nodes, edges} slice, filterable by type."""
    from tests.factories import make_task

    task = make_task(db, project_id=sample_project.id, title="Mapped")
    db.commit()
    topic = client.post("/api/nodes", json={"type": "topic", "title": "Q3"}).json()
    client.post(f"/api/nodes/{topic['id']}/edges", json={"target_id": sample_project.id, "rel_type": "contains"})

    r = client.get("/api/graph/map")
    assert r.status_code == 200
    body = r.json()
    ids = {n["id"] for n in body["nodes"]}
    assert {topic["id"], sample_project.id, task.id} <= ids
    # Nodes are hot-columns only (no heavy data payload).
    assert "data" not in body["nodes"][0]
    rels = {(e["source_id"], e["target_id"], e["rel_type"]) for e in body["edges"]}
    assert (topic["id"], sample_project.id, "contains") in rels
    assert (sample_project.id, task.id, "contains") in rels

    # Type filter narrows nodes and drops edges whose endpoints fall outside.
    r = client.get("/api/graph/map", params={"types": "topic"})
    body = r.json()
    assert {n["id"] for n in body["nodes"]} == {topic["id"]}
    assert body["edges"] == []

    # include=data exposes the payload (needed for client-side enrichment).
    r = client.get("/api/graph/map", params={"include": "data"})
    task_node = next(n for n in r.json()["nodes"] if n["id"] == task.id)
    assert "data" in task_node


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


# --- Share facade management (ADR-0039) ---------------------------------------


@pytest.fixture()
def shareable_topic(client):
    client.post(
        "/api/graph-types/nodes",
        json={"key": "topic", "label": "Topic", "roles": ["container", "shareable"]},
    )
    return client.post("/api/nodes", json={"type": "topic", "title": "Launch"}).json()


def test_rotate_token_on_shareable_node(client, shareable_topic):
    r = client.post(f"/api/nodes/{shareable_topic['id']}/share/rotate-token")
    assert r.status_code == 200
    token = r.json()["share_token"]
    assert token
    # The generic share route now resolves it.
    assert client.get(f"/share/node/{token}").status_code == 200


def test_share_ops_rejected_on_non_shareable_type(client, topic_type):
    # topic_type is not shareable — every share op returns 400.
    node = client.post("/api/nodes", json={"type": "topic", "title": "X"}).json()
    assert client.post(f"/api/nodes/{node['id']}/share/rotate-token").status_code == 400
    assert client.post(f"/api/nodes/{node['id']}/share/set-pin", json={"pin": "1234"}).status_code == 400


def test_set_and_clear_pin_and_expiry(client, shareable_topic):
    nid = shareable_topic["id"]
    assert client.post(f"/api/nodes/{nid}/share/set-pin", json={"pin": "4321"}).status_code == 200
    assert client.post(f"/api/nodes/{nid}/share/set-pin", json={"pin": "12"}).status_code == 400
    assert client.delete(f"/api/nodes/{nid}/share/pin").status_code == 200
    assert client.post(f"/api/nodes/{nid}/share/set-expiry", json={"expires_at": None}).status_code == 200


def test_share_ops_404_on_missing_node(client):
    assert client.post("/api/nodes/nope/share/rotate-token").status_code == 404


def test_set_guest_notes_on_shareable_node(client, shareable_topic):
    nid = shareable_topic["id"]
    token = client.post(f"/api/nodes/{nid}/share/rotate-token").json()["share_token"]

    assert client.post(f"/api/nodes/{nid}/share/set-guest-notes", json={"allowed": True}).status_code == 200
    assert client.get(f"/share/node/{token}").json()["meta"]["guest_notes_enabled"] is True

    assert client.post(f"/api/nodes/{nid}/share/set-guest-notes", json={"allowed": False}).status_code == 200
    assert client.get(f"/share/node/{token}").json()["meta"]["guest_notes_enabled"] is False


def test_guest_notes_rejected_on_non_shareable_type(client, topic_type):
    node = client.post("/api/nodes", json={"type": "topic", "title": "X"}).json()
    r = client.post(f"/api/nodes/{node['id']}/share/set-guest-notes", json={"allowed": True})
    assert r.status_code == 400


def test_generic_share_page_records_its_own_views(client, shareable_topic):
    """A count nobody records is a zero that looks like a fact (ADR-0070).

    Before the generic facade logged views, /share/node/{token} on a user-defined
    shareable type served the page and reported 0 views forever.
    """
    nid = shareable_topic["id"]
    token = client.post(f"/api/nodes/{nid}/share/rotate-token").json()["share_token"]
    assert client.get(f"/api/nodes/{nid}/share-views").json()["view_count"] == 0

    client.get(f"/share/node/{token}")

    assert client.get(f"/api/nodes/{nid}/share-views").json()["view_count"] == 1


def test_share_views_404_and_400_like_the_other_share_ops(client, topic_type):
    node = client.post("/api/nodes", json={"type": "topic", "title": "X"}).json()
    assert client.get(f"/api/nodes/{node['id']}/share-views").status_code == 400
    assert client.get("/api/nodes/nope/share-views").status_code == 404


# --- Role-driven write surface (ADR-0040) -------------------------------------
# The generic /api/nodes surface used to be a "dumb write": it inserted a Node and
# returned, skipping notifications / rules / activity that the dedicated routers
# fire. These tests pin that a task written through /api/nodes now runs the same
# ADR-0038 pipeline (the silent-downgrade bug that motivated ADR-0040).


def _activity_actions(db, task_id):
    from app.models import ActivityLog

    return {a.action for a in db.query(ActivityLog).filter(ActivityLog.task_id == task_id).all()}


def test_task_created_via_nodes_runs_pipeline(client, db, sample_project):
    r = client.post("/api/nodes", json={"type": "task", "title": "Ship it"})
    assert r.status_code == 201
    task_id = r.json()["id"]
    # finalize_task_create logged task.created — proof the pipeline ran, not a dumb write.
    assert "task.created" in _activity_actions(db, task_id)


def test_task_status_change_via_nodes_fires_status_events(client, db):
    task_id = client.post("/api/nodes", json={"type": "task", "title": "Do"}).json()["id"]
    r = client.patch(f"/api/nodes/{task_id}", json={"status": "done"})
    assert r.status_code == 200
    assert r.json()["status"] == "done"
    # apply_task_update logged the transition (and fired task.status_changed /
    # task.done notifications) — the reaction that /api/nodes used to silently drop.
    assert "task.status_changed" in _activity_actions(db, task_id)


def test_task_create_via_nodes_with_container_returns_enriched(client, sample_project):
    # ADR-0040 single write surface: container_id files the task under a project in
    # one call and the response is the enriched TaskOut shape (project_id resolved).
    r = client.post(
        "/api/nodes",
        json={"type": "task", "title": "Filed", "priority": "high", "container_id": sample_project.id},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["project_id"] == sample_project.id
    assert body["priority"] == "high"
    assert "subtask_count" in body  # enriched TaskOut, not a bare NodeOut


def test_task_create_via_nodes_with_parent_is_subtask(client, sample_project, db):
    parent = client.post(
        "/api/nodes", json={"type": "task", "title": "Parent", "container_id": sample_project.id}
    ).json()
    child = client.post("/api/nodes", json={"type": "task", "title": "Child", "parent_id": parent["id"]}).json()
    assert child["parent_id"] == parent["id"]
    assert child["id"] in graph.contained_task_ids(db, parent["id"])


def test_task_reparent_via_nodes_patch(client, sample_project):
    a = client.post("/api/nodes", json={"type": "task", "title": "A", "container_id": sample_project.id}).json()
    b = client.post("/api/nodes", json={"type": "task", "title": "B", "container_id": sample_project.id}).json()
    r = client.patch(f"/api/nodes/{b['id']}", json={"parent_id": a["id"]})
    assert r.status_code == 200
    assert r.json()["parent_id"] == a["id"]


def test_task_create_via_nodes_unknown_container_404(client):
    r = client.post("/api/nodes", json={"type": "task", "title": "X", "container_id": "nope"})
    assert r.status_code == 404


def test_task_delete_via_nodes_cleans_subtree(client, db):
    parent = client.post("/api/nodes", json={"type": "task", "title": "Parent"}).json()["id"]
    child = client.post("/api/nodes", json={"type": "task", "title": "Child"}).json()["id"]
    client.post(f"/api/nodes/{parent}/edges", json={"target_id": child, "rel_type": "contains"})

    assert client.delete(f"/api/nodes/{parent}").status_code == 204
    from app.models import Node

    # delete_task_tree removed the subtask too (plain delete_node would have orphaned it).
    assert db.get(Node, parent) is None
    assert db.get(Node, child) is None
    assert "task.deleted" in _activity_actions(db, parent)
