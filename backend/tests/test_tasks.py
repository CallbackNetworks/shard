def _url(project_id, suffix=""):
    return f"/api/projects/{project_id}/tasks{suffix}"


# Task writes go through the single graph write surface /api/nodes (ADR-0040 stage 3c);
# the dedicated /projects/{id}/tasks create/patch/delete routes were retired. Reads,
# reorder, dependencies, and regenerate-token stay on the task router (via ``_url``).
def _create(client, project_id, **fields):
    return client.post("/api/nodes", json={"type": "task", "container_id": project_id, **fields})


def _patch(client, task_id, **fields):
    return client.patch(f"/api/nodes/{task_id}", json=fields)


def _delete(client, task_id):
    return client.delete(f"/api/nodes/{task_id}")


# --- 1. Create a task ---


def test_create_task(client, sample_project):
    pid = sample_project.id
    resp = _create(client, pid, title="My task")
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "My task"
    assert data["status"] == "todo"
    assert data["priority"] == "medium"
    assert data["project_id"] == pid
    assert data["callback_token"]


def test_create_task_with_priority(client, sample_project):
    resp = _create(client, sample_project.id, title="Urgent", priority="high")
    assert resp.status_code == 201
    assert resp.json()["priority"] == "high"


# --- 2. List tasks ---


def test_list_tasks_empty(client, sample_project):
    resp = client.get(_url(sample_project.id))
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_tasks_with_data(client, sample_project):
    pid = sample_project.id
    _create(client, pid, title="Task A")
    _create(client, pid, title="Task B")
    resp = client.get(_url(pid))
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert "Task A" in titles
    assert "Task B" in titles


# --- 3. Status filter ---


def test_list_tasks_status_filter(client, sample_project):
    pid = sample_project.id
    tid = _create(client, pid, title="Todo task").json()["id"]
    _patch(client, tid, status="done")
    _create(client, pid, title="Still todo")

    resp = client.get(_url(pid), params={"status": "done"})
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Todo task"
    assert tasks[0]["status"] == "done"


# --- 4. Update task ---


def test_update_task_status(client, sample_project):
    tid = _create(client, sample_project.id, title="WIP").json()["id"]
    resp = _patch(client, tid, status="in_progress")
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


def test_update_task_priority(client, sample_project):
    tid = _create(client, sample_project.id, title="Low prio").json()["id"]
    resp = _patch(client, tid, priority="high")
    assert resp.status_code == 200
    assert resp.json()["priority"] == "high"


def test_update_task_not_found(client, sample_project):
    resp = _patch(client, "nonexistent-id", title="Nope")
    assert resp.status_code == 404


# --- 5. Delete task ---


def test_delete_task(client, sample_project):
    pid = sample_project.id
    tid = _create(client, pid, title="To delete").json()["id"]
    resp = _delete(client, tid)
    assert resp.status_code == 204

    # Confirm it is gone
    listing = client.get(_url(pid))
    assert all(t["id"] != tid for t in listing.json())


def test_delete_task_not_found(client, sample_project):
    resp = _delete(client, "nonexistent-id")
    assert resp.status_code == 404


# --- 6. Subtask ---


def test_create_subtask(client, sample_project):
    pid = sample_project.id
    parent_id = _create(client, pid, title="Parent").json()["id"]
    resp = _create(client, pid, title="Child", parent_id=parent_id)
    assert resp.status_code == 201
    assert resp.json()["parent_id"] == parent_id


def test_create_subtask_with_unknown_parent_rejected(client, sample_project):
    resp = _create(client, sample_project.id, title="Orphan", parent_id="no-such-task")
    assert resp.status_code == 404


def test_reparent_task(client, sample_project):
    pid = sample_project.id
    a = _create(client, pid, title="A").json()["id"]
    b = _create(client, pid, title="B").json()["id"]
    resp = _patch(client, b, parent_id=a)
    assert resp.status_code == 200
    assert resp.json()["parent_id"] == a


def test_reparent_to_unknown_parent_rejected(client, sample_project):
    pid = sample_project.id
    a = _create(client, pid, title="A").json()["id"]
    resp = _patch(client, a, parent_id="no-such-task")
    assert resp.status_code == 404
    # No dangling containment was left behind: the task is still top-level.
    listed = {t["id"]: t for t in client.get(_url(pid)).json()}
    assert listed[a]["parent_id"] is None


def test_reparent_cycle_rejected(client, sample_project):
    pid = sample_project.id
    a = _create(client, pid, title="A").json()["id"]
    b = _create(client, pid, title="B", parent_id=a).json()["id"]
    # A under its own subtask B would close a containment loop.
    resp = _patch(client, a, parent_id=b)
    assert resp.status_code == 400
    # Self-parenting is a cycle too.
    resp = _patch(client, a, parent_id=a)
    assert resp.status_code == 400


def test_reparent_to_parent_in_other_project_rejected(client, sample_project):
    other = client.post("/api/nodes", json={"type": "project", "title": "Other"}).json()["id"]
    foreign_parent = _create(client, other, title="Foreign").json()["id"]
    a = _create(client, sample_project.id, title="A").json()["id"]
    resp = _patch(client, a, parent_id=foreign_parent)
    assert resp.status_code == 404


# --- 7. Dependencies ---


def test_add_and_remove_dependency(client, sample_project):
    pid = sample_project.id
    t1 = _create(client, pid, title="Blocker").json()["id"]
    t2 = _create(client, pid, title="Blocked").json()["id"]

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
    tid = _create(client, pid, title="Self ref").json()["id"]
    resp = client.post(_url(pid, f"/{tid}/dependencies/{tid}"))
    assert resp.status_code == 400
    assert "itself" in resp.json()["detail"].lower()


# --- 9. Reorder tasks ---


def test_reorder_tasks(client, sample_project):
    pid = sample_project.id
    t1 = _create(client, pid, title="First").json()["id"]
    t2 = _create(client, pid, title="Second").json()["id"]
    t3 = _create(client, pid, title="Third").json()["id"]

    # Reverse the order
    resp = client.post(_url(pid, "/reorder"), json={"task_ids": [t3, t2, t1]})
    assert resp.status_code == 204

    tasks = client.get(_url(pid)).json()
    positions = {t["id"]: t["position"] for t in tasks}
    assert positions[t3] < positions[t2] < positions[t1]


# --- 10. Regenerate callback token ---


def test_regenerate_callback_token(client, sample_project):
    pid = sample_project.id
    task = _create(client, pid, title="Token task").json()
    old_token = task["callback_token"]

    resp = client.post(_url(pid, f"/{task['id']}/regenerate-token"))
    assert resp.status_code == 200
    new_token = resp.json()["callback_token"]
    assert new_token != old_token


# --- Unified mutation pipeline (ADR-0038) ---


def test_web_status_done_fires_status_events(client, sample_project, monkeypatch):
    """Web updates now emit task.{status} and project.complete like API/webhook paths."""
    from app.services import task_mutations

    events = []

    async def fake_notify(db, task, event, **kwargs):
        events.append(event)

    monkeypatch.setattr(task_mutations, "fire_notifications", fake_notify)
    pid = sample_project.id
    tid = _create(client, pid, title="Only task").json()["id"]
    resp = _patch(client, tid, status="done")
    assert resp.status_code == 200
    assert "task.status_changed" in events
    assert "task.done" in events
    assert "project.complete" in events


def test_web_update_rejects_bad_agent_key(client, sample_project):
    tid = _create(client, sample_project.id, title="Agent task").json()["id"]
    resp = _patch(client, tid, assigned_agent_key_id="missing")
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"]
