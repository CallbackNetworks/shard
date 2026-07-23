"""Goal-as-container behaviour (ADR-0041).

A goal carries the ``container`` role: projects it groups are ``goal -> project``
``contains`` edges, it can hold tasks directly (``goal -> task``), and its
progress is task-weighted over the whole subtree.
"""


def _project(client, name="P"):
    return client.post("/api/projects", json={"name": name}).json()["id"]


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
    goal_id = client.post("/api/goals", json={"title": "G", "project_ids": [pid]}).json()["id"]

    # The link is a goal -> project ``contains`` edge, and the project reads back.
    assert graph.project_ids_for_goal(db, goal_id) == [pid]
    assert graph.container_type_keys(db) >= {"project", "goal"}


def test_goal_holds_task_directly_without_project(client, db):
    from app.services import graph

    goal_id = client.post("/api/goals", json={"title": "G"}).json()["id"]
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
    goal_id = client.post("/api/goals", json={"title": "G", "project_ids": [pid]}).json()["id"]

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
    goal_id = client.post("/api/goals", json={"title": "G", "project_ids": [a]}).json()["id"]
    direct = _task(client, goal_id, "kept")

    client.patch(f"/api/goals/{goal_id}", json={"project_ids": [b]})

    assert graph.project_ids_for_goal(db, goal_id) == [b]
    # The directly-held task survives the project swap.
    assert direct["id"] in graph.descendants_of(db, goal_id)
