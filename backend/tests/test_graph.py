"""Tests for the graph layer (ADR-0032, phase 1)."""

import pytest

from app.services import graph


def test_create_and_get_node(db):
    node = graph.create_node(db, graph.NODE_TASK, title="Write tests", status="todo", priority="high")
    db.commit()

    fetched = graph.get_node(db, node.id)
    assert fetched is not None
    assert fetched.type == "task"
    assert fetched.title == "Write tests"
    assert fetched.status == "todo"
    assert fetched.priority == "high"


def test_create_node_folds_unknown_fields_into_data(db):
    node = graph.create_node(db, graph.NODE_PROJECT, title="Shard", description="a tool", repo_url="http://x")
    db.commit()
    assert node.data == {"description": "a tool", "repo_url": "http://x"}
    assert node.title == "Shard"


def test_create_node_with_explicit_id(db):
    node = graph.create_node(db, graph.NODE_LABEL, id="fixed-id", title="bug")
    db.commit()
    assert node.id == "fixed-id"


def test_update_node_splits_columns_and_data(db):
    node = graph.create_node(db, graph.NODE_TASK, title="t", status="todo")
    db.commit()

    graph.update_node(db, node.id, status="done", note="finished")
    db.commit()

    refreshed = graph.get_node(db, node.id)
    assert refreshed.status == "done"
    assert refreshed.data == {"note": "finished"}


def test_delete_node_removes_touching_edges(db):
    a = graph.create_node(db, graph.NODE_PROJECT, title="p")
    b = graph.create_node(db, graph.NODE_TASK, title="t")
    graph.add_edge(db, a.id, b.id, graph.REL_CONTAINS)
    db.commit()

    assert graph.delete_node(db, b.id) is True
    db.commit()

    assert graph.get_node(db, b.id) is None
    assert graph.children_of(db, a.id) == []


def test_add_edge_is_idempotent(db):
    a = graph.create_node(db, graph.NODE_PROJECT, title="p")
    b = graph.create_node(db, graph.NODE_TASK, title="t")
    e1 = graph.add_edge(db, a.id, b.id, graph.REL_CONTAINS)
    e2 = graph.add_edge(db, a.id, b.id, graph.REL_CONTAINS)
    db.commit()
    assert e1.id == e2.id


def test_remove_edge(db):
    a = graph.create_node(db, graph.NODE_TASK, title="a")
    b = graph.create_node(db, graph.NODE_TASK, title="b")
    graph.add_edge(db, a.id, b.id, graph.REL_DEPENDS_ON)
    db.commit()

    assert graph.remove_edge(db, a.id, b.id, graph.REL_DEPENDS_ON) is True
    db.commit()
    assert graph.neighbors(db, a.id, graph.REL_DEPENDS_ON) == []
    assert graph.remove_edge(db, a.id, b.id, graph.REL_DEPENDS_ON) is False


def test_neighbors_direction_and_order(db):
    parent = graph.create_node(db, graph.NODE_PROJECT, title="p")
    c1 = graph.create_node(db, graph.NODE_TASK, title="c1")
    c2 = graph.create_node(db, graph.NODE_TASK, title="c2")
    graph.add_edge(db, parent.id, c2.id, graph.REL_CONTAINS, position=2)
    graph.add_edge(db, parent.id, c1.id, graph.REL_CONTAINS, position=1)
    db.commit()

    out = graph.neighbors(db, parent.id, graph.REL_CONTAINS, direction="out")
    assert [n.title for n in out] == ["c1", "c2"]  # ordered by edge position

    incoming = graph.neighbors(db, c1.id, graph.REL_CONTAINS, direction="in")
    assert [n.id for n in incoming] == [parent.id]


def test_parents_children_ancestors(db):
    proj = graph.create_node(db, graph.NODE_PROJECT, title="proj")
    parent = graph.create_node(db, graph.NODE_TASK, title="parent")
    child = graph.create_node(db, graph.NODE_TASK, title="child")
    graph.add_edge(db, proj.id, parent.id, graph.REL_CONTAINS)
    graph.add_edge(db, parent.id, child.id, graph.REL_CONTAINS)
    db.commit()

    assert [n.id for n in graph.children_of(db, parent.id)] == [child.id]
    assert [n.id for n in graph.parents_of(db, child.id)] == [parent.id]
    ancestor_ids = {n.id for n in graph.ancestors_of(db, child.id)}
    assert ancestor_ids == {parent.id, proj.id}


def test_nearest_ancestor_of_type(db):
    proj = graph.create_node(db, graph.NODE_PROJECT, title="proj")
    parent = graph.create_node(db, graph.NODE_TASK, title="parent")
    child = graph.create_node(db, graph.NODE_TASK, title="child")
    graph.add_edge(db, proj.id, parent.id, graph.REL_CONTAINS)
    graph.add_edge(db, parent.id, child.id, graph.REL_CONTAINS)
    db.commit()

    found = graph.nearest_ancestor_of_type(db, child.id, graph.NODE_PROJECT)
    assert found is not None and found.id == proj.id
    assert graph.nearest_ancestor_of_type(db, child.id, graph.NODE_GOAL) is None


def test_multi_membership(db):
    p1 = graph.create_node(db, graph.NODE_PROJECT, title="p1")
    p2 = graph.create_node(db, graph.NODE_PROJECT, title="p2")
    task = graph.create_node(db, graph.NODE_TASK, title="shared")
    graph.add_edge(db, p1.id, task.id, graph.REL_CONTAINS)
    graph.add_edge(db, p2.id, task.id, graph.REL_CONTAINS)
    db.commit()

    parent_ids = {n.id for n in graph.parents_of(db, task.id)}
    assert parent_ids == {p1.id, p2.id}


def test_detect_cycle_and_add_edge_guard(db):
    a = graph.create_node(db, graph.NODE_TASK, title="a")
    b = graph.create_node(db, graph.NODE_TASK, title="b")
    graph.add_edge(db, a.id, b.id, graph.REL_CONTAINS)  # a contains b
    db.commit()

    assert graph.detect_cycle(db, b.id, a.id) is True  # b contains a would loop
    assert graph.detect_cycle(db, a.id, a.id) is True  # self-loop
    assert graph.detect_cycle(db, a.id, b.id) is False  # already exists, no new cycle

    with pytest.raises(ValueError):
        graph.add_edge(db, b.id, a.id, graph.REL_CONTAINS)
