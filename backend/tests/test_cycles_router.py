from tests.factories import make_task


def _url(project_id, suffix=""):
    return f"/api/projects/{project_id}/cycles{suffix}"


def _make_task(db, project_id, title="Test task", status="todo"):
    t = make_task(db, project_id=project_id, title=title, status=status)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# --- 1. List cycles when none exist ---


def test_list_cycles_empty(client, db, sample_project):
    r = client.get(_url(sample_project.id))
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a cycle ---


def test_create_cycle(client, db, sample_project):
    r = client.post(
        _url(sample_project.id),
        json={"name": "Sprint 1", "status": "draft"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Sprint 1"
    assert data["status"] == "draft"
    assert data["project_id"] == sample_project.id
    assert "id" in data
    assert "created_at" in data
    assert data["task_ids"] == []
    assert data["total_tasks"] == 0
    assert data["done_tasks"] == 0


# --- 3. Get a single cycle ---


def test_get_cycle(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Sprint 2"},
    )
    cycle_id = create_r.json()["id"]

    r = client.get(_url(sample_project.id, f"/{cycle_id}"))
    assert r.status_code == 200
    assert r.json()["id"] == cycle_id
    assert r.json()["name"] == "Sprint 2"


# --- 4. Update cycle status ---


def test_update_cycle_status(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Sprint 3", "status": "draft"},
    )
    cycle_id = create_r.json()["id"]

    r = client.patch(
        _url(sample_project.id, f"/{cycle_id}"),
        json={"status": "active"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    assert r.json()["name"] == "Sprint 3"


# --- 5. Delete a cycle ---


def test_delete_cycle(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "To Delete"},
    )
    cycle_id = create_r.json()["id"]

    r = client.delete(_url(sample_project.id, f"/{cycle_id}"))
    assert r.status_code == 204

    r = client.get(_url(sample_project.id, f"/{cycle_id}"))
    assert r.status_code == 404


# --- 6. Add a task to a cycle ---


def test_add_task_to_cycle(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Sprint with tasks"},
    )
    cycle_id = create_r.json()["id"]

    task = _make_task(db, sample_project.id)

    r = client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task.id}"))
    assert r.status_code == 201
    data = r.json()
    assert data["cycle_id"] == cycle_id
    assert data["task_id"] == task.id


# --- 7. Remove a task from a cycle ---


def test_remove_task_from_cycle(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Sprint remove"},
    )
    cycle_id = create_r.json()["id"]

    task = _make_task(db, sample_project.id)
    client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task.id}"))

    r = client.delete(_url(sample_project.id, f"/{cycle_id}/tasks/{task.id}"))
    assert r.status_code == 204

    # Verify the task is no longer in the cycle
    cycle_r = client.get(_url(sample_project.id, f"/{cycle_id}"))
    assert task.id not in cycle_r.json()["task_ids"]


# --- 8. Cycle enrichment with tasks ---


def test_cycle_enrichment(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Enriched Sprint"},
    )
    cycle_id = create_r.json()["id"]

    task1 = _make_task(db, sample_project.id, title="Task A", status="todo")
    task2 = _make_task(db, sample_project.id, title="Task B", status="done")
    task3 = _make_task(db, sample_project.id, title="Task C", status="in_progress")

    client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task1.id}"))
    client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task2.id}"))
    client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task3.id}"))

    r = client.get(_url(sample_project.id, f"/{cycle_id}"))
    assert r.status_code == 200
    data = r.json()
    assert data["total_tasks"] == 3
    assert data["done_tasks"] == 1
    assert set(data["task_ids"]) == {task1.id, task2.id, task3.id}


# --- 9. Duplicate a cycle ---


def test_duplicate_cycle(client, db, sample_project):
    create_r = client.post(
        _url(sample_project.id),
        json={"name": "Original Sprint", "status": "active"},
    )
    cycle_id = create_r.json()["id"]

    task = _make_task(db, sample_project.id, title="Sprint task")
    client.post(_url(sample_project.id, f"/{cycle_id}/tasks/{task.id}"))

    r = client.post(_url(sample_project.id, f"/{cycle_id}/duplicate"))
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Original Sprint (copy)"
    assert data["status"] == "draft"
    assert data["id"] != cycle_id
    # Duplicated cycle should have cloned tasks (new task IDs)
    assert data["total_tasks"] == 1
    assert task.id not in data["task_ids"]  # cloned, not the same task


# --- 10. Compare two cycles ---


def test_compare_cycles(client, db, sample_project):
    r1 = client.post(
        _url(sample_project.id),
        json={"name": "Cycle A"},
    )
    cycle_a_id = r1.json()["id"]

    r2 = client.post(
        _url(sample_project.id),
        json={"name": "Cycle B"},
    )
    cycle_b_id = r2.json()["id"]

    task_done = _make_task(db, sample_project.id, title="Done task", status="done")
    task_todo = _make_task(db, sample_project.id, title="Todo task", status="todo")

    client.post(_url(sample_project.id, f"/{cycle_a_id}/tasks/{task_done.id}"))
    client.post(_url(sample_project.id, f"/{cycle_b_id}/tasks/{task_todo.id}"))

    r = client.get(
        _url(sample_project.id, f"/{cycle_a_id}/compare"),
        params={"compare_with": cycle_b_id},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["cycle_a"]["cycle_id"] == cycle_a_id
    assert data["cycle_a"]["name"] == "Cycle A"
    assert data["cycle_a"]["total_tasks"] == 1
    assert data["cycle_a"]["done"] == 1
    assert data["cycle_a"]["completion_rate"] == 100.0

    assert data["cycle_b"]["cycle_id"] == cycle_b_id
    assert data["cycle_b"]["name"] == "Cycle B"
    assert data["cycle_b"]["total_tasks"] == 1
    assert data["cycle_b"]["done"] == 0
    assert data["cycle_b"]["completion_rate"] == 0


# --- 11. Get nonexistent cycle returns 404 ---


def test_get_nonexistent_cycle(client, db, sample_project):
    r = client.get(_url(sample_project.id, "/nonexistent-id"))
    assert r.status_code == 404


# --- 12. Create cycle with dates ---


def test_create_cycle_with_dates(client, db, sample_project):
    r = client.post(
        _url(sample_project.id),
        json={
            "name": "Dated Sprint",
            "status": "draft",
            "start_date": "2026-06-01T00:00:00Z",
            "end_date": "2026-06-14T00:00:00Z",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Dated Sprint"
    assert data["start_date"] is not None
    assert data["end_date"] is not None
    assert "2026-06-01" in data["start_date"]
    assert "2026-06-14" in data["end_date"]
