"""The before_flush listener mirrors entities/containment into the graph (ADR-0032)."""

from app.models import (
    Edge,
    Identity,
    Project,
    Task,
)
from app.services import graph


def _edge(db, source_id, target_id, rel_type):
    return (
        db.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .first()
    )


def _project(db):
    p = Project(name="p")
    db.add(p)
    db.flush()
    return p


def _task(db, project_id, title="t"):
    t = Task(project_id=project_id, title=title)
    db.add(t)
    db.flush()
    return t


def test_membership_edge_via_helper(db):
    p = _project(db)
    ident = Identity(name="me")
    db.add(ident)
    db.flush()

    graph.link_membership(db, ident.id, p.id)
    db.commit()
    assert _edge(db, ident.id, p.id, "member_of") is not None
    assert graph.unlink_membership(db, ident.id, p.id) is True
    db.commit()
    assert _edge(db, ident.id, p.id, "member_of") is None


def test_entity_delete_clears_membership_edge(db):
    from app.models import Node

    p = _project(db)
    ident = Identity(name="me")
    db.add(ident)
    db.flush()
    graph.link_membership(db, ident.id, p.id)
    db.commit()

    db.delete(ident)
    db.commit()
    # Deleting the identity node drops the touching member_of edge.
    assert db.get(Node, ident.id) is None
    assert _edge(db, ident.id, p.id, "member_of") is None


def test_task_create_mirrors_node_and_contains_edge(db):
    from app.models import Node

    p = _project(db)
    t = _task(db, p.id)

    assert db.get(Node, p.id).type == "project"
    assert db.get(Node, t.id).type == "task"
    assert _edge(db, p.id, t.id, "contains") is not None


def test_subtask_create_mirrors_parent_containment(db):
    p = _project(db)
    parent = _task(db, p.id, "parent")
    child = Task(project_id=p.id, parent_id=parent.id, title="child")
    db.add(child)
    db.commit()

    assert _edge(db, parent.id, child.id, "contains") is not None  # parent contains child
    assert _edge(db, p.id, child.id, "contains") is not None  # project contains child too


def test_entity_delete_removes_node(db):
    from app.models import Node

    p = _project(db)
    t = _task(db, p.id)
    tid = t.id
    db.delete(t)
    db.commit()

    assert db.get(Node, tid) is None
    assert _edge(db, p.id, tid, "contains") is None
