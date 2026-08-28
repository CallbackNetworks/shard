"""Tests for the node/edge type registries and built-in seeding (ADR-0033)."""

from app.models import EdgeType, NodeType
from app.services import graph
from app.services.graph_registry import (
    BUILTIN_EDGE_TYPES,
    BUILTIN_NODE_TYPES,
    seed_builtin_types,
)


def test_seed_inserts_all_builtins(db):
    seed_builtin_types(db)

    node_keys = {k for (k,) in db.query(NodeType.key).all()}
    edge_keys = {k for (k,) in db.query(EdgeType.key).all()}

    assert node_keys == {s["key"] for s in BUILTIN_NODE_TYPES}
    assert edge_keys == {s["key"] for s in BUILTIN_EDGE_TYPES}
    # The seeded set matches the graph vocabulary constants.
    assert node_keys == {
        graph.NODE_PROJECT,
        graph.NODE_TASK,
        graph.NODE_IDENTITY,
        graph.NODE_GOAL,
        graph.NODE_CYCLE,
        graph.NODE_LABEL,
        graph.NODE_DECISION,
    }


def test_seed_marks_builtins_and_containment(db):
    seed_builtin_types(db)

    task_type = db.get(NodeType, graph.NODE_TASK)
    assert task_type.is_builtin is True
    assert task_type.label == "Task"

    contains = db.get(EdgeType, graph.REL_CONTAINS)
    assert contains.is_builtin is True
    assert contains.is_containment is True

    depends = db.get(EdgeType, graph.REL_DEPENDS_ON)
    assert depends.is_containment is False


def test_seed_marks_capability_flags(db):
    # ADR-0039: cross-cutting capabilities are seeded on identity and project,
    # and only on those two among the built-ins.
    seed_builtin_types(db)

    for key in (graph.NODE_IDENTITY, graph.NODE_PROJECT):
        nt = db.get(NodeType, key)
        assert nt.has_role("shareable") is True, key
        assert nt.has_role("subscribable") is True, key

    for key in (graph.NODE_TASK, graph.NODE_GOAL, graph.NODE_CYCLE, graph.NODE_LABEL):
        nt = db.get(NodeType, key)
        assert nt.has_role("shareable") is False, key
        assert nt.has_role("subscribable") is False, key


def test_seed_is_idempotent(db):
    seed_builtin_types(db)
    seed_builtin_types(db)

    assert db.query(NodeType).count() == len(BUILTIN_NODE_TYPES)
    assert db.query(EdgeType).count() == len(BUILTIN_EDGE_TYPES)


def test_seed_preserves_user_customization(db):
    seed_builtin_types(db)
    # A user renames a built-in and adds a custom type.
    db.get(NodeType, graph.NODE_TASK).label = "Ticket"
    db.add(NodeType(key="topic", label="Topic", is_builtin=False))
    db.commit()

    seed_builtin_types(db)  # re-seed must not clobber the rename or drop the custom type

    assert db.get(NodeType, graph.NODE_TASK).label == "Ticket"
    assert db.get(NodeType, "topic") is not None


def test_capability_key_sets(db):
    # ADR-0039: capability key-sets are data-driven from the flags.
    seed_builtin_types(db)
    assert graph.shareable_type_keys(db) == {graph.NODE_IDENTITY, graph.NODE_PROJECT}
    assert graph.subscribable_type_keys(db) == {graph.NODE_IDENTITY, graph.NODE_PROJECT}


def test_find_node_by_share_token_spans_shareable_types(db):
    # A custom "topic" type opts into shareable; a topic node with a share_token
    # is then resolvable by the generic lookup, exactly like identity/project.
    seed_builtin_types(db)
    db.add(NodeType(key="topic", label="Topic", is_builtin=False, roles=["shareable"]))
    db.commit()
    node = graph.create_node(db, "topic", title="Launch", share_token="tok-123")
    db.commit()

    found = graph.find_node_by_share_token(db, "tok-123")
    assert found is not None and found.id == node.id
    assert graph.node_is_shareable(db, found) is True
    assert graph.node_is_subscribable(db, found) is False
    assert graph.find_node_by_share_token(db, "nope") is None


def test_find_node_by_share_token_ignores_non_shareable_types(db):
    # A token sitting on a non-shareable type's node must not resolve.
    seed_builtin_types(db)
    db.add(NodeType(key="note", label="Note", is_builtin=False, roles=[]))
    db.commit()
    graph.create_node(db, "note", title="Secret", share_token="tok-x")
    db.commit()
    assert graph.find_node_by_share_token(db, "tok-x") is None
