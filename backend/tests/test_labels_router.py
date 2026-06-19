from app.models import Label, Task, TaskLabel


def _label_url(project_id, suffix=""):
    return f"/projects/{project_id}/labels{suffix}"


def _task_label_url(project_id, task_id, label_id):
    return f"/projects/{project_id}/tasks/{task_id}/labels/{label_id}"


def _make_task(db, project_id):
    t = Task(project_id=project_id, title="Test task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _make_label(db, project_id, name="Bug", color="#e5484d"):
    label = Label(project_id=project_id, name=name, color=color)
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


# --- 1. List labels on a fresh project ---


def test_list_labels_empty(client, sample_project):
    r = client.get(_label_url(sample_project.id))
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a label with explicit color ---


def test_create_label(client, sample_project):
    r = client.post(
        _label_url(sample_project.id),
        json={"name": "Bug", "color": "#e5484d"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Bug"
    assert data["color"] == "#e5484d"
    assert data["project_id"] == sample_project.id
    assert "id" in data


# --- 3. Create a label with default color ---


def test_create_label_with_defaults(client, sample_project):
    r = client.post(
        _label_url(sample_project.id),
        json={"name": "Feature"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Feature"
    assert data["color"] == "#5e6ad2"  # default color
    assert data["type"] == "label"  # default type


# --- 4. Update a label ---


def test_update_label(client, db, sample_project):
    label = _make_label(db, sample_project.id, name="Old Name", color="#aaaaaa")

    r = client.patch(
        _label_url(sample_project.id, f"/{label.id}"),
        json={"name": "New Name", "color": "#bbbbbb"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "New Name"
    assert data["color"] == "#bbbbbb"


# --- 5. Delete a label ---


def test_delete_label(client, db, sample_project):
    label = _make_label(db, sample_project.id)

    r = client.delete(_label_url(sample_project.id, f"/{label.id}"))
    assert r.status_code == 204

    listing = client.get(_label_url(sample_project.id))
    assert listing.json() == []


# --- 6. Add a label to a task ---


def test_add_label_to_task(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    label = _make_label(db, sample_project.id)

    r = client.post(_task_label_url(sample_project.id, task.id, label.id))
    assert r.status_code == 201
    data = r.json()
    assert data["id"] == label.id
    assert data["name"] == label.name


# --- 7. Remove a label from a task ---


def test_remove_label_from_task(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    label = _make_label(db, sample_project.id)

    # Assign the label first
    client.post(_task_label_url(sample_project.id, task.id, label.id))

    # Remove it
    r = client.delete(_task_label_url(sample_project.id, task.id, label.id))
    assert r.status_code == 204

    # Verify the association is gone in the DB
    assoc = (
        db.query(TaskLabel)
        .filter(
            TaskLabel.task_id == task.id,
            TaskLabel.label_id == label.id,
        )
        .first()
    )
    assert assoc is None


# --- 8. Deleting a label cascades to task-label association ---


def test_delete_label_cascades(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    label = _make_label(db, sample_project.id, name="Cascade")

    # Assign the label to the task
    client.post(_task_label_url(sample_project.id, task.id, label.id))

    # Verify the association exists
    assoc = (
        db.query(TaskLabel)
        .filter(
            TaskLabel.task_id == task.id,
            TaskLabel.label_id == label.id,
        )
        .first()
    )
    assert assoc is not None

    # Delete the label itself
    r = client.delete(_label_url(sample_project.id, f"/{label.id}"))
    assert r.status_code == 204

    # The task-label association should be gone too
    db.expire_all()
    assoc = (
        db.query(TaskLabel)
        .filter(
            TaskLabel.task_id == task.id,
            TaskLabel.label_id == label.id,
        )
        .first()
    )
    assert assoc is None
