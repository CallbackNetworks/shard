"""Container aggregation is subtree-shaped (ADR-0065).

A ``contains`` child may be a task *or* another container. Every rollup used to ask
only for the task half, so work moved one level down disappeared from the level
above. These tests pin the two halves of the fix: the rollup counts the whole
subtree, and ``/api/nodes/{id}/subtree`` names the containers the tasks live in.
"""

import pytest

from app.services import graph
from tests.factories import make_project, make_task


@pytest.fixture()
def area_type(client):
    """A user-defined container type — the level a user inserts by hand."""
    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "roles": ["container"]})
    return "area"


def _contain(client, parent_id, child_id):
    r = client.post(f"/api/nodes/{parent_id}/edges", json={"target_id": child_id, "rel_type": "contains"})
    assert r.status_code in (200, 201), r.text
    return r


def test_flat_container_rollup_matches_direct_children(client, db):
    """With nothing nested the subtree figure is exactly the old direct-children one."""
    project = make_project(db, name="Flat")
    make_task(db, project_id=project.id, title="a", status="done")
    make_task(db, project_id=project.id, title="b")
    db.commit()

    stats = graph.container_subtree_stats(db, project.id)
    assert (stats.total_tasks, stats.done_tasks, stats.progress) == (2, 1, 50.0)
    assert stats.direct_task_count == 2
    assert stats.child_container_count == 0


def test_project_counts_tasks_held_by_a_nested_container(client, db, area_type):
    """The bug this closes: a task one level down still belongs to the project above."""
    project = make_project(db, name="Parent")
    make_task(db, project_id=project.id, title="direct", status="done")
    area = client.post("/api/nodes", json={"type": "area", "title": "Area 1"}).json()
    _contain(client, project.id, area["id"])
    nested = make_task(db, title="nested")
    db.commit()
    _contain(client, area["id"], nested.id)

    body = client.get(f"/api/projects/{project.id}").json()
    # Two tasks in the subtree, one done — not the single direct child.
    assert (body["total_tasks"], body["done_tasks"], body["progress"]) == (2, 1, 50.0)
    # ...while the board still shows only what this level directly holds, and says so.
    assert [t["title"] for t in body["tasks"]] == ["direct"]
    assert body["direct_task_count"] == 1
    assert body["child_container_count"] == 1


def test_rollup_reaches_through_several_levels(client, db, area_type):
    """Depth is not capped at one: containers nest as deep as the user builds them."""
    top = client.post("/api/nodes", json={"type": "area", "title": "top"}).json()
    mid = client.post("/api/nodes", json={"type": "area", "title": "mid"}).json()
    project = make_project(db, name="deep")
    leaf = make_task(db, project_id=project.id, title="leaf", status="done")
    db.commit()
    _contain(client, top["id"], mid["id"])
    _contain(client, mid["id"], project.id)

    stats = graph.container_subtree_stats(db, top["id"])
    assert (stats.total_tasks, stats.done_tasks, stats.progress) == (1, 1, 100.0)
    assert stats.direct_task_count == 0
    assert graph.container_subtree_stats(db, mid["id"]).total_tasks == 1
    assert leaf.id in graph.descendants_of(db, top["id"])


def test_subtasks_are_not_counted_twice_across_levels(client, db, area_type):
    """Only top-level tasks weigh in — a parent task and its subtasks are one unit."""
    area = client.post("/api/nodes", json={"type": "area", "title": "Area"}).json()
    project = make_project(db, name="p")
    parent = make_task(db, project_id=project.id, title="parent")
    make_task(db, project_id=project.id, parent_id=parent.id, title="child", status="done")
    db.commit()
    _contain(client, area["id"], project.id)

    stats = graph.container_subtree_stats(db, area["id"])
    assert (stats.total_tasks, stats.done_tasks) == (1, 0)


def test_direct_count_uses_the_same_rule_as_the_total(client, db):
    """``total - direct`` must mean "work one level down", so both count top-level only.

    A project may hold a subtask directly (the subtask edge and the project edge are
    both ``contains``); counting those as direct tasks made a plain project look like
    it had negative work nested below it.
    """
    project = make_project(db, name="p")
    parent = make_task(db, project_id=project.id, title="parent")
    make_task(db, project_id=project.id, parent_id=parent.id, title="child")
    db.commit()

    stats = graph.container_subtree_stats(db, project.id)
    assert stats.total_tasks == 1
    assert stats.direct_task_count == 1
    assert stats.total_tasks - stats.direct_task_count == 0


def test_a_shared_task_counts_once(client, db, area_type):
    """Multi-membership is legal (ADR-0032); a diamond must not inflate the total."""
    area = client.post("/api/nodes", json={"type": "area", "title": "Area"}).json()
    left = make_project(db, name="left")
    right = make_project(db, name="right")
    shared = make_task(db, project_id=left.id, title="shared")
    db.commit()
    _contain(client, right.id, shared.id)
    _contain(client, area["id"], left.id)
    _contain(client, area["id"], right.id)

    assert graph.container_subtree_stats(db, area["id"]).total_tasks == 1


def test_subtree_endpoint_lists_child_containers_with_their_rollups(client, db, area_type):
    """The container view's missing half: what sits *below* this node, and how big it is."""
    area = client.post("/api/nodes", json={"type": "area", "title": "Q3"}).json()
    project = make_project(db, name="Inner", status="active")
    make_task(db, project_id=project.id, title="x", status="done")
    make_task(db, project_id=project.id, title="y")
    held = make_task(db, title="held directly")
    db.commit()
    _contain(client, area["id"], project.id)
    _contain(client, area["id"], held.id)

    body = client.get(f"/api/nodes/{area['id']}/subtree").json()
    assert body["id"] == area["id"]
    assert body["type"] == "area"
    assert body["total_tasks"] == 3
    assert body["done_tasks"] == 1
    assert body["direct_task_count"] == 1
    assert body["child_container_count"] == 1
    assert len(body["children"]) == 1
    child = body["children"][0]
    assert child["id"] == project.id
    assert child["title"] == "Inner"
    assert child["status"] == "active"
    assert (child["total_tasks"], child["done_tasks"], child["progress"]) == (2, 1, 50.0)


def test_subtree_endpoint_on_a_leaf_container(client, area_type):
    area = client.post("/api/nodes", json={"type": "area", "title": "Empty"}).json()
    body = client.get(f"/api/nodes/{area['id']}/subtree").json()
    assert body["children"] == []
    assert body["total_tasks"] == 0
    assert body["progress"] == 0.0


def test_subtree_endpoint_unknown_node(client):
    assert client.get("/api/nodes/nope/subtree").status_code == 404


def test_goal_progress_reads_the_same_rule(client, db):
    """ADR-0041's goal figure is now the generic container figure, not a second copy."""
    goal = client.post("/api/nodes", json={"type": graph.NODE_GOAL, "title": "Ship it"}).json()
    project = make_project(db, name="under goal")
    make_task(db, project_id=project.id, title="a", status="done")
    make_task(db, project_id=project.id, title="b")
    db.commit()
    _contain(client, goal["id"], project.id)

    assert graph.goal_subtree_progress(db, goal["id"]) == 50.0
    assert graph.container_subtree_stats(db, goal["id"]).progress == 50.0
