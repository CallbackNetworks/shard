"""Tests for the graph_events provenance audit trail (ADR-0033)."""

from app.models import GraphEvent
from app.services import graph


def test_create_node_logs_event(db):
    node = graph.create_node(db, "task", title="X", actor="alice")
    db.commit()
    ev = db.query(GraphEvent).filter(GraphEvent.event == "node_created", GraphEvent.node_id == node.id).one()
    assert ev.actor == "alice"
    assert ev.data == {"type": "task"}


def test_add_and_remove_edge_log_events(db):
    a = graph.create_node(db, "task", title="A")
    b = graph.create_node(db, "task", title="B")
    graph.add_edge(db, a.id, b.id, graph.REL_DEPENDS_ON, actor="bob")
    db.commit()
    added = db.query(GraphEvent).filter(GraphEvent.event == "edge_added", GraphEvent.source_id == a.id).one()
    assert added.rel_type == graph.REL_DEPENDS_ON
    assert added.actor == "bob"

    graph.remove_edge(db, a.id, b.id, graph.REL_DEPENDS_ON)
    db.commit()
    assert db.query(GraphEvent).filter(GraphEvent.event == "edge_removed", GraphEvent.source_id == a.id).count() == 1


def test_add_edge_idempotent_logs_once(db):
    a = graph.create_node(db, "task", title="A")
    b = graph.create_node(db, "task", title="B")
    graph.add_edge(db, a.id, b.id, graph.REL_DEPENDS_ON)
    graph.add_edge(db, a.id, b.id, graph.REL_DEPENDS_ON)  # duplicate returns existing, no new event
    db.commit()
    assert db.query(GraphEvent).filter(GraphEvent.event == "edge_added", GraphEvent.source_id == a.id).count() == 1


def test_remove_edge_absent_logs_nothing(db):
    a = graph.create_node(db, "task", title="A")
    b = graph.create_node(db, "task", title="B")
    db.commit()
    graph.remove_edge(db, a.id, b.id, graph.REL_DEPENDS_ON)
    db.commit()
    assert db.query(GraphEvent).filter(GraphEvent.event == "edge_removed").count() == 0


def test_delete_node_logs_event(db):
    node = graph.create_node(db, "task", title="X")
    db.commit()
    graph.delete_node(db, node.id, actor="carol")
    db.commit()
    ev = db.query(GraphEvent).filter(GraphEvent.event == "node_deleted", GraphEvent.node_id == node.id).one()
    assert ev.actor == "carol"


def test_node_events_endpoint(client):
    client.post("/api/graph-types/nodes", json={"key": "topic", "label": "Topic"})
    a = client.post("/api/nodes", json={"type": "topic", "title": "A"}).json()
    b = client.post("/api/nodes", json={"type": "topic", "title": "B"}).json()
    client.post(f"/api/nodes/{a['id']}/edges", json={"target_id": b["id"], "rel_type": "contains"})

    events = client.get(f"/api/nodes/{a['id']}/events").json()
    kinds = {e["event"] for e in events}
    assert "node_created" in kinds
    assert "edge_added" in kinds
