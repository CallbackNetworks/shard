def _url(project_id, suffix=""):
    return f"/projects/{project_id}/tasks{suffix}"


# --- 1. Create a task ---


def test_create_task(client, sample_project):
    pid = sample_project.id
    resp = client.post(_url(pid), json={"title": "My task"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "My task"
    assert data["status"] == "todo"
    assert data["priority"] == "medium"
    assert data["project_id"] == pid
    assert data["callback_token"]


def test_create_task_with_priority(client, sample_project):
    resp = client.post(
        _url(sample_project.id),
        json={"title": "Urgent", "priority": "high"},
    )
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


# --- 2. List tasks ---


def test_list_tasks_empty(client, sample_project):
    resp = client.get(_url(sample_project.id))
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_tasks_with_data(client, sample_project):
    pid = sample_project.id
    client.post(_url(pid), json={"title": "Task A"})
    client.post(_url(pid), json={"title": "Task B"})
    resp = client.get(_url(pid))
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Task A" in titles
    assert "Task B" in titles


# --- 3. Status filter ---


def test_list_tasks_status_filter(client, sample_project):
    pid = sample_project.id
    r1 = client.post(_url(pid), json={"title": "Todo task"})
    tid = r1.json()["id"]
    client.patch(_url(pid, f"/{tid}"), json={"status": "done"})
    client.post(_url(pid), json={"title": "Still todo"})

    resp = client.get(_url(pid), params={"status": "done"})
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Todo task"
    assert tasks[0]["status"] == "done"


# --- 4. Update task ---


def test_update_task_status(client, sample_project):
    pid = sample_project.id
    tid = client.post(_url(pid), json={"title": "WIP"}).json()["id"]
    resp = client.patch(_url(pid, f"/{tid}"), json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


def test_update_task_priority(client, sample_project):
    pid = sample_project.id
    tid = client.post(_url(pid), json={"title": "Low prio"}).json()["id"]
    resp = client.patch(_url(pid, f"/{tid}"), json={"priority": "high"})
    assert resp.status_code == 200
    assert resp.json()["priority"] == "high"


def test_update_task_not_found(client, sample_project):
    resp = client.patch(
        _url(sample_project.id, "/nonexistent-id"),
        json={"title": "Nope"},
    )
    assert resp.status_code == 404


# --- 5. Delete task ---


def test_delete_task(client, sample_project):
    pid = sample_project.id
    tid = client.post(_url(pid), json={"title": "To delete"}).json()["id"]
    resp = client.delete(_url(pid, f"/{tid}"))
    assert resp.status_code == 204

    # Confirm it is gone
    listing = client.get(_url(pid))
    assert all(t["id"] != tid for t in listing.json())


def test_delete_task_not_found(client, sample_project):
    resp = client.delete(_url(sample_project.id, "/nonexistent-id"))
    assert resp.status_code == 404


# --- 6. Subtask ---


def test_create_subtask(client, sample_project):
    pid = sample_project.id
    parent_id = client.post(_url(pid), json={"title": "Parent"}).json()["id"]
    resp = client.post(
        _url(pid),
        json={"title": "Child", "parent_id": parent_id},
    )
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == parent_id


def test_create_subtask_with_unknown_parent_rejected(client, sample_project):
    resp = client.post(_url(sample_project.id), json={"title": "Orphan", "parent_id": "no-such-task"})
    assert resp.status_code == 404


def test_reparent_task(client, sample_project):
    pid = sample_project.id
    a = client.post(_url(pid), json={"title": "A"}).json()["id"]
    b = client.post(_url(pid), json={"title": "B"}).json()["id"]
    resp = client.patch(_url(pid, f"/{b}"), json={"parent_id": a})
    assert resp.status_code == 200
    assert resp.json()["parent_id"] == a


def test_reparent_to_unknown_parent_rejected(client, sample_project):
    pid = sample_project.id
    a = client.post(_url(pid), json={"title": "A"}).json()["id"]
    resp = client.patch(_url(pid, f"/{a}"), json={"parent_id": "no-such-task"})
    assert resp.status_code == 404
    # No dangling containment was left behind: the task is still top-level.
    listed = {t["id"]: t for t in client.get(_url(pid)).json()}
    assert listed[a]["parent_id"] is None


def test_reparent_cycle_rejected(client, sample_project):
    pid = sample_project.id
    a = client.post(_url(pid), json={"title": "A"}).json()["id"]
    b = client.post(_url(pid), json={"title": "B", "parent_id": a}).json()["id"]
    # A under its own subtask B would close a containment loop.
    resp = client.patch(_url(pid, f"/{a}"), json={"parent_id": b})
    assert resp.status_code == 400
    # Self-parenting is a cycle too.
    resp = client.patch(_url(pid, f"/{a}"), json={"parent_id": a})
    assert resp.status_code == 400


def test_reparent_to_parent_in_other_project_rejected(client, sample_project):
    other = client.post("/projects", json={"name": "Other"}).json()["id"]
    foreign_parent = client.post(_url(other), json={"title": "Foreign"}).json()["id"]
    a = client.post(_url(sample_project.id), json={"title": "A"}).json()["id"]
    resp = client.patch(_url(sample_project.id, f"/{a}"), json={"parent_id": foreign_parent})
    assert resp.status_code == 404


# --- 7. Dependencies ---


def test_add_and_remove_dependency(client, sample_project):
    pid = sample_project.id
    t1 = client.post(_url(pid), json={"title": "Blocker"}).json()["id"]
    t2 = client.post(_url(pid), json={"title": "Blocked"}).json()["id"]

    # Add dependency: t2 depends on t1
    resp = client.post(_url(pid, f"/{t2}/dependencies/{t1}"))
    assert resp.status_code == 201
    body = resp.json()
    assert body["task_id"] == t2
    assert body["depends_on_id"] == t1

    # Remove dependency
    resp = client.delete(_url(pid, f"/{t2}/dependencies/{t1}"))
    assert resp.status_code == 204


# --- 8. Self-dependency rejected ---


def test_self_dependency_rejected(client, sample_project):
    pid = sample_project.id
    tid = client.post(_url(pid), json={"title": "Self ref"}).json()["id"]
    resp = client.post(_url(pid, f"/{tid}/dependencies/{tid}"))
    assert resp.status_code == 400
    assert "itself" in resp.json()["detail"].lower()


# --- 9. Reorder tasks ---


def test_reorder_tasks(client, sample_project):
    pid = sample_project.id
    t1 = client.post(_url(pid), json={"title": "First"}).json()["id"]
    t2 = client.post(_url(pid), json={"title": "Second"}).json()["id"]
    t3 = client.post(_url(pid), json={"title": "Third"}).json()["id"]

    # Reverse the order
    resp = client.post(_url(pid, "/reorder"), json={"task_ids": [t3, t2, t1]})
    assert resp.status_code == 204

    tasks = client.get(_url(pid)).json()
    positions = {t["id"]: t["position"] for t in tasks}
    assert positions[t3] < positions[t2] < positions[t1]


# --- 10. Regenerate callback token ---


def test_regenerate_callback_token(client, sample_project):
    pid = sample_project.id
    task = client.post(_url(pid), json={"title": "Token task"}).json()
    old_token = task["callback_token"]

    resp = client.post(_url(pid, f"/{task['id']}/regenerate-token"))
    assert resp.status_code == 200
    new_token = resp.json()["callback_token"]
    assert new_token != old_token
