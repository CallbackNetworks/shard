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
