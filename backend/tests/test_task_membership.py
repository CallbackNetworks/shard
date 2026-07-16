"""Cross-project task membership via graph contains edges (ADR-0032, phase 2)."""


def _make_project(client, name):
    return client.post("/projects", json={"name": name}).json()["id"]


def _make_task(client, project_id, title):
    return client.post(f"/projects/{project_id}/tasks", json={"title": title}).json()["id"]


def test_add_membership_surfaces_task_in_both_projects(client):
    a = _make_project(client, "Project A")
    b = _make_project(client, "Project B")
    tid = _make_task(client, a, "Shared task")

    resp = client.post(f"/projects/{a}/tasks/{tid}/memberships/{b}")
    assert resp.status_code == 201
    body = resp.json()
    assert body["project_id"] == a  # home project unchanged
    assert set(body["project_ids"]) == {a, b}

    # Task now surfaces under project B's enriched task list.
    proj_b = client.get(f"/projects/{b}").json()
    assert tid in [t["id"] for t in proj_b["tasks"]]

    # Still present in its home project A.
    proj_a = client.get(f"/projects/{a}").json()
    assert tid in [t["id"] for t in proj_a["tasks"]]


def test_remove_membership(client):
    a = _make_project(client, "A")
    b = _make_project(client, "B")
    tid = _make_task(client, a, "t")
    client.post(f"/projects/{a}/tasks/{tid}/memberships/{b}")

    resp = client.delete(f"/projects/{a}/tasks/{tid}/memberships/{b}")
    assert resp.status_code == 204

    proj_b = client.get(f"/projects/{b}").json()
    assert tid not in [t["id"] for t in proj_b["tasks"]]

    # In its home project's enriched view the task is back to a single membership.
    proj_a = client.get(f"/projects/{a}").json()
    task = next(t for t in proj_a["tasks"] if t["id"] == tid)
    assert task["project_ids"] == [a]


def test_membership_to_home_project_rejected(client):
    a = _make_project(client, "A")
    tid = _make_task(client, a, "t")
    resp = client.post(f"/projects/{a}/tasks/{tid}/memberships/{a}")
    assert resp.status_code == 400


def test_remove_original_membership_from_other_project(client):
    """No primary (ADR-0032): any membership may be removed, including the original one."""
    a = _make_project(client, "A")
    b = _make_project(client, "B")
    tid = _make_task(client, a, "t")
    client.post(f"/projects/{a}/tasks/{tid}/memberships/{b}")

    # From B's view, unlink the task from A (the project it was created in).
    resp = client.delete(f"/projects/{b}/tasks/{tid}/memberships/{a}")
    assert resp.status_code == 204

    proj_a = client.get(f"/projects/{a}").json()
    assert tid not in [t["id"] for t in proj_a["tasks"]]
    proj_b = client.get(f"/projects/{b}").json()
    task = next(t for t in proj_b["tasks"] if t["id"] == tid)
    assert task["project_ids"] == [b]
    assert task["project_id"] == b


def test_remove_last_membership_rejected(client):
    a = _make_project(client, "A")
    tid = _make_task(client, a, "t")
    resp = client.delete(f"/projects/{a}/tasks/{tid}/memberships/{a}")
    assert resp.status_code == 400


def test_compat_project_id_is_oldest_membership_everywhere(client):
    """The compat project_id is deterministic (oldest membership) across read paths."""
    a = _make_project(client, "A")
    b = _make_project(client, "B")
    tid = _make_task(client, a, "t")
    client.post(f"/projects/{a}/tasks/{tid}/memberships/{b}")

    # Enriched project view from B still reports A as the compat project.
    proj_b = client.get(f"/projects/{b}").json()
    task = next(t for t in proj_b["tasks"] if t["id"] == tid)
    assert task["project_id"] == a
    assert task["project_ids"][0] == a
    # The flat list endpoint agrees.
    listed = {t["id"]: t for t in client.get(f"/projects/{b}/tasks").json()}
    assert listed[tid]["project_id"] == a


def test_remove_missing_membership_404(client):
    a = _make_project(client, "A")
    b = _make_project(client, "B")
    tid = _make_task(client, a, "t")
    resp = client.delete(f"/projects/{a}/tasks/{tid}/memberships/{b}")
    assert resp.status_code == 404


def test_membership_unknown_target_project_404(client):
    a = _make_project(client, "A")
    tid = _make_task(client, a, "t")
    resp = client.post(f"/projects/{a}/tasks/{tid}/memberships/does-not-exist")
    assert resp.status_code == 404
