from app.services import graph
from tests.factories import make_task


def _label_url(project_id, suffix=""):
    return f"/api/projects/{project_id}/labels{suffix}"


def _task_label_url(project_id, task_id, label_id):
    return f"/api/projects/{project_id}/tasks/{task_id}/labels/{label_id}"


def _make_task(db, project_id):
    t = make_task(db, project_id=project_id, title="Test task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _make_label(db, project_id, name="Bug", color="#e5484d"):
    label = graph.create_label(db, project_id, name=name, color=color)
    db.commit()
    return label


# --- 1. List labels on a fresh project ---


def test_list_labels_empty(client, sample_project):
    r = client.get(_label_url(sample_project.id))
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a label with explicit color ---


def test_create_label(client, sample_project):
    # ADR-0043: a label is a container-scoped node — created through /api/nodes.
    r = client.post(
        "/api/nodes",
        json={"type": "label", "container_id": sample_project.id, "title": "Bug", "data": {"color": "#e5484d"}},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Bug"
    assert data["data"]["color"] == "#e5484d"
    # The enriched label read exposes the project scope.
    labels = client.get(_label_url(sample_project.id)).json()
    assert any(x["id"] == data["id"] and x["project_id"] == sample_project.id for x in labels)


# --- 3. Create a label with default color ---


def test_create_label_with_defaults(client, sample_project):
    r = client.post("/api/nodes", json={"type": "label", "container_id": sample_project.id, "title": "Feature"})
    assert r.status_code == 201
    lid = r.json()["id"]
    label = next(x for x in client.get(_label_url(sample_project.id)).json() if x["id"] == lid)
    assert label["name"] == "Feature"
    assert label["color"] == "#5e6ad2"  # default color (read-side)
    assert label["type"] == "label"  # default type


# --- 4. Update a label ---


def test_update_label(client, db, sample_project):
    label = _make_label(db, sample_project.id, name="Old Name", color="#aaaaaa")

    r = client.patch(f"/api/nodes/{label.id}", json={"title": "New Name", "data": {"color": "#bbbbbb"}})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "New Name"
    assert data["data"]["color"] == "#bbbbbb"


# --- 5. Delete a label ---


def test_delete_label(client, db, sample_project):
    label = _make_label(db, sample_project.id)

    r = client.delete(f"/api/nodes/{label.id}")
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
    assert label.id not in graph.label_ids_for_task(db, task.id)


# --- 8. Deleting a label cascades to task-label association ---


def test_delete_label_cascades(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    label = _make_label(db, sample_project.id, name="Cascade")

    # Assign the label to the task
    client.post(_task_label_url(sample_project.id, task.id, label.id))

    # Verify the association exists
    assert label.id in graph.label_ids_for_task(db, task.id)

    # Delete the label itself
    r = client.delete(f"/api/nodes/{label.id}")
    assert r.status_code == 204

    # The task-label association should be gone too
    db.expire_all()
    assert label.id not in graph.label_ids_for_task(db, task.id)
