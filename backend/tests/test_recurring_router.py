from app.models import Task


def _url(project_id, task_id, suffix=""):
    return f"/projects/{project_id}/tasks/{task_id}/recurrence{suffix}"


def _make_task(db, project_id):
    t = Task(project_id=project_id, title="Recurring task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# --- 1. GET with no recurrence returns 404 ---


def test_get_no_recurrence(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 404


# --- 2. Create a daily recurrence ---


def test_create_recurrence(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    r = client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "daily",
            "next_run_at": "2026-06-01T08:00:00Z",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["frequency"] == "daily"
    assert data["template_task_id"] == task.id
    assert data["interval_value"] == 1
    assert data["active"] is True
    assert "id" in data
    assert "created_at" in data


# --- 3. GET returns the rule after creation ---


def test_get_recurrence_after_create(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "weekly",
            "day_of_week": 0,
            "next_run_at": "2026-06-02T08:00:00Z",
        },
    )

    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 200
    data = r.json()
    assert data["frequency"] == "weekly"
    assert data["day_of_week"] == 0
    assert data["template_task_id"] == task.id


# --- 4. Duplicate POST returns 409 ---


def test_create_duplicate_returns_409(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "daily",
            "next_run_at": "2026-06-01T08:00:00Z",
        },
    )

    r = client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "weekly",
            "next_run_at": "2026-06-02T08:00:00Z",
        },
    )
    assert r.status_code == 409


# --- 5. Update recurrence frequency ---


def test_update_recurrence(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "daily",
            "next_run_at": "2026-06-01T08:00:00Z",
        },
    )

    r = client.patch(
        _url(sample_project.id, task.id),
        json={"frequency": "weekly", "day_of_week": 3},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["frequency"] == "weekly"
    assert data["day_of_week"] == 3


# --- 6. Update recurrence with interval frequency ---


def test_update_recurrence_interval(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "daily",
            "next_run_at": "2026-06-01T08:00:00Z",
        },
    )

    r = client.patch(
        _url(sample_project.id, task.id),
        json={"frequency": "interval", "interval_value": 5},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["frequency"] == "interval"
    assert data["interval_value"] == 5


# --- 7. Delete recurrence ---


def test_delete_recurrence(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "daily",
            "next_run_at": "2026-06-01T08:00:00Z",
        },
    )

    r = client.delete(_url(sample_project.id, task.id))
    assert r.status_code == 204


# --- 8. GET after delete returns 404 ---


def test_get_after_delete(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    client.post(
        _url(sample_project.id, task.id),
        json={
            "frequency": "monthly",
            "day_of_month": 15,
            "next_run_at": "2026-06-15T08:00:00Z",
        },
    )

    client.delete(_url(sample_project.id, task.id))

    r = client.get(_url(sample_project.id, task.id))
    assert r.status_code == 404
