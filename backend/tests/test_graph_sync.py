"""The before_flush listener mirrors entities/containment into the graph (ADR-0032)."""

from app.models import (
    Edge,
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
    ident = graph.create_identity(db, name="me")

    graph.link_membership(db, ident.id, p.id)
    db.commit()
    assert _edge(db, ident.id, p.id, "member_of") is not None
    assert graph.unlink_membership(db, ident.id, p.id) is True
    db.commit()
    assert _edge(db, ident.id, p.id, "member_of") is None


def test_entity_delete_clears_membership_edge(db):
    from app.models import Node

    p = _project(db)
    ident = graph.create_identity(db, name="me")
    graph.link_membership(db, ident.id, p.id)
    db.commit()

    graph.delete_identity(db, ident.id)
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


def test_task_node_is_complete_mirror(db):
    """ADR-0033 B5.1: task node.data mirrors every non-hot Task field."""
    from app.models import Node, Task

    p = _project(db)
    t = Task(
        project_id=p.id,
        title="T",
        description="desc",
        assignee="me",
        time_estimate=30,
        progress_pct=42,
        external_provider="github",
        external_id="99",
    )
    db.add(t)
    db.commit()

    data = db.get(Node, t.id).data or {}
    assert data["description"] == "desc"
    assert data["assignee"] == "me"
    assert data["time_estimate"] == 30
    assert data["progress_pct"] == 42
    assert data["external_provider"] == "github"
    assert data["external_id"] == "99"
    assert data["callback_token"] == t.callback_token

    # Updating a non-hot field re-syncs the node.
    t.description = "changed"
    db.commit()
    assert (db.get(Node, t.id).data or {})["description"] == "changed"


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


def test_task_create_syncs_node_hot_fields(db):
    from datetime import datetime

    from app.models import Node

    p = _project(db)
    due = datetime(2026, 8, 1, 12, 0)
    t = Task(project_id=p.id, title="t", status="in_progress", priority="high", due_date=due, is_pinned=True)
    db.add(t)
    db.commit()

    node = db.get(Node, t.id)
    assert node.status == "in_progress"
    assert node.priority == "high"
    assert node.is_pinned is True
    assert node.due_date is not None


def test_task_update_resyncs_node_hot_fields(db):
    from app.models import Node

    p = _project(db)
    t = _task(db, p.id, "old title")

    t.title = "new title"
    t.status = "done"
    t.priority = "low"
    t.is_pinned = True
    db.commit()

    node = db.get(Node, t.id)
    assert node.title == "new title"
    assert node.status == "done"
    assert node.priority == "low"
    assert node.is_pinned is True


def test_project_update_resyncs_node(db):
    from app.models import Node

    p = _project(db)
    p.name = "renamed"
    p.status = "archived"
    db.commit()

    node = db.get(Node, p.id)
    assert node.title == "renamed"
    assert node.status == "archived"


def test_task_reparent_project_via_edges(db):
    # Re-parenting is now an explicit edge operation (ADR-0032), not a column write.
    p1 = _project(db)
    p2 = _project(db)
    t = _task(db, p1.id)
    assert _edge(db, p1.id, t.id, "contains") is not None

    graph.remove_edge(db, p1.id, t.id, graph.REL_CONTAINS)
    graph.add_edge(db, p2.id, t.id, graph.REL_CONTAINS)
    db.commit()

    assert _edge(db, p1.id, t.id, "contains") is None
    assert _edge(db, p2.id, t.id, "contains") is not None


def test_task_reparent_parent_via_edges(db):
    p = _project(db)
    parent1 = _task(db, p.id, "parent1")
    parent2 = _task(db, p.id, "parent2")
    child = Task(project_id=p.id, parent_id=parent1.id, title="child")
    db.add(child)
    db.commit()
    assert _edge(db, parent1.id, child.id, "contains") is not None

    graph.remove_edge(db, parent1.id, child.id, graph.REL_CONTAINS)
    graph.add_edge(db, parent2.id, child.id, graph.REL_CONTAINS)
    db.commit()
    assert _edge(db, parent1.id, child.id, "contains") is None
    assert _edge(db, parent2.id, child.id, "contains") is not None


def test_subtask_helpers_from_contains_edges(db):
    p = _project(db)
    parent = _task(db, p.id, "parent")
    child1 = Task(project_id=p.id, parent_id=parent.id, title="child1")
    child2 = Task(project_id=p.id, parent_id=parent.id, title="child2")
    db.add_all([child1, child2])
    db.commit()

    all_ids = [parent.id, child1.id, child2.id]

    # subtask_ids_among: only the two children are subtasks (parent has no task-parent).
    assert graph.subtask_ids_among(db, all_ids) == {child1.id, child2.id}

    # child_task_ids_map: parent -> its two subtasks, children -> none.
    child_map = graph.child_task_ids_map(db, all_ids)
    assert set(child_map.get(parent.id, [])) == {child1.id, child2.id}
    assert child_map.get(child1.id, []) == []

    # subtasks(): task rows of the parent's children.
    assert {s.id for s in graph.subtasks(db, parent.id)} == {child1.id, child2.id}


def test_top_level_task_filter_excludes_subtasks(db):
    p = _project(db)
    top = _task(db, p.id, "top")
    child = Task(project_id=p.id, parent_id=top.id, title="child")
    db.add(child)
    db.commit()

    top_ids = {t.id for t in db.query(Task).filter(graph.top_level_task_filter()).all()}
    assert top.id in top_ids
    assert child.id not in top_ids
