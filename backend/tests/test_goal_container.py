"""Goal-as-container behaviour (ADR-0041).

A goal carries the ``container`` role: projects it groups are ``goal -> project``
``contains`` edges, it can hold tasks directly (``goal -> task``), and its
progress is task-weighted over the whole subtree. Goal writes go through the
single graph write surface ``/api/nodes`` (+ ``/edges`` for project links); the
``/goals`` router is read-only (ADR-0041 step c).
"""


def _project(client, name="P"):
    return client.post("/api/nodes", json={"type": "project", "title": name}).json()["id"]


def _goal(client, title="G", project_ids=()):
    """Create a goal via the generic node surface and link projects as contains edges."""
    goal_id = client.post("/api/nodes", json={"type": "goal", "title": title, "status": "active"}).json()["id"]
    for pid in project_ids:
        client.post(f"/api/nodes/{goal_id}/edges", json={"target_id": pid, "rel_type": "contains"})
    return goal_id


def _task(client, container_id, title, status="todo"):
    return client.post(
        "/api/nodes",
        json={"type": "task", "container_id": container_id, "title": title, "data": {"status": status}},
    ).json()


def _set_status(client, task_id, status):
    client.patch(f"/api/nodes/{task_id}", json={"status": status})


def test_goal_links_project_via_contains(client, db):
    from app.services import graph

    pid = _project(client, "A")
    goal_id = _goal(client, "G", project_ids=[pid])

    # The link is a goal -> project ``contains`` edge, and the project reads back.
    assert graph.project_ids_for_goal(db, goal_id) == [pid]
    assert graph.container_type_keys(db) >= {"project", "goal"}


def test_goal_holds_task_directly_without_project(client, db):
    from app.services import graph

    goal_id = _goal(client, "G")
    task = _task(client, goal_id, "orphan-for-goal")

    # ADR-0034 compat: no literal project, but the goal shows up as a container.
    assert task["project_id"] is None
    assert task["project_ids"] == []
    assert goal_id in task["container_ids"]
    assert task["id"] in graph.descendants_of(db, goal_id)
    # A directly-held task is NOT a link project.
    assert graph.project_ids_for_goal(db, goal_id) == []


def test_goal_progress_is_task_weighted_over_subtree(client):
    pid = _project(client, "P")
    goal_id = _goal(client, "G", project_ids=[pid])

    # Two tasks nested in the project (one done) + one task held directly by the goal (done).
    _task(client, pid, "p1", status="done")
    _task(client, pid, "p2", status="todo")
    direct = _task(client, goal_id, "d1")
    _set_status(client, direct["id"], "done")

    goal = client.get(f"/api/goals/{goal_id}").json()
    # 2 done out of 3 top-level tasks across the whole subtree.
    assert goal["progress"] == round(2 / 3 * 100, 1)
    # Per-project breakdown is unchanged (project P: 1/2 done).
    proj_row = next(p for p in goal["projects"] if p["project_id"] == pid)
    assert proj_row["progress"] == 50.0


def test_goal_project_replacement_keeps_direct_tasks(client, db):
    from app.services import graph

    a = _project(client, "A")
    b = _project(client, "B")
    goal_id = _goal(client, "G", project_ids=[a])
    direct = _task(client, goal_id, "kept")

    # Replace the linked project via the generic edge surface (what the frontend client
    # now does): detach goal -> A, attach goal -> B. The direct task edge is untouched.
    client.delete(f"/api/nodes/{goal_id}/edges", params={"target_id": a, "rel_type": "contains"})
    client.post(f"/api/nodes/{goal_id}/edges", json={"target_id": b, "rel_type": "contains"})

    assert graph.project_ids_for_goal(db, goal_id) == [b]
    # The directly-held task survives the project swap.
    assert direct["id"] in graph.descendants_of(db, goal_id)


def test_status_default_is_the_same_rule_for_listing_and_reading(client, db):
    """A container created without a status must still list as active (ADR-0075).

    ``/api/nodes`` sends no status, so the column is NULL and every view renders it
    "active". ``all_projects``/``all_goals`` filtered the column instead, so a container
    could read as active and be missing from the active listing at the same time.
    """
    from app.services import graph

    pid = _project(client, "no status given")
    goal_id = _goal(client, "no status either")

    assert graph.get_project(db, pid).status == "active"
    assert graph.get_goal(db, goal_id).status == "active"
    assert pid in [p.id for p in graph.all_projects(db, status="active")]
    assert goal_id in [g.id for g in graph.all_goals(db, status="active")]

    # An explicit status still filters exactly, and does not pick up the NULL rows.
    client.patch(f"/api/nodes/{pid}", json={"status": "archived"})
    assert pid not in [p.id for p in graph.all_projects(db, status="active")]
    assert pid in [p.id for p in graph.all_projects(db, status="archived")]
