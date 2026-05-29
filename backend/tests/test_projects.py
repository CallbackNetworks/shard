from app.models import Task


def test_create_project(client):
    resp = client.post("/projects", json={"name": "My Project", "description": "A test project"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Project"
    assert data["description"] == "A test project"
    assert data["status"] == "active"
    assert data["progress"] == 0.0
    assert data["total_tasks"] == 0
    assert data["done_tasks"] == 0
    assert data["tasks"] == []
    assert data["labels"] == []
    assert data["id"] is not None


def test_create_project_minimal(client):
    resp = client.post("/projects", json={"name": "Minimal"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Minimal"
    assert data["description"] is None


def test_list_projects_empty(client):
    resp = client.get("/projects")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_projects_with_data(client, sample_project):
    resp = client.get("/projects")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Test Project"


def test_get_project(client, sample_project):
    resp = client.get(f"/projects/{sample_project.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sample_project.id
    assert data["name"] == "Test Project"
    assert data["status"] == "active"
    assert len(data["identities"]) == 1


def test_get_project_not_found(client):
    resp = client.get("/projects/nonexistent-id")
    assert resp.status_code == 404


def test_update_project_name(client, sample_project):
    resp = client.patch(
        f"/projects/{sample_project.id}",
        json={"name": "Renamed Project"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed Project"


def test_update_project_status_archived(client, sample_project):
    resp = client.patch(
        f"/projects/{sample_project.id}",
        json={"status": "archived"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "archived"


def test_update_project_not_found(client):
    resp = client.patch("/projects/nonexistent-id", json={"name": "X"})
    assert resp.status_code == 404


def test_delete_project(client, sample_project):
    resp = client.delete(f"/projects/{sample_project.id}")
    assert resp.status_code == 204

    resp = client.get(f"/projects/{sample_project.id}")
    assert resp.status_code == 404


def test_delete_project_not_found(client):
    resp = client.delete("/projects/nonexistent-id")
    assert resp.status_code == 404


def test_progress_no_tasks(client, sample_project):
    resp = client.get(f"/projects/{sample_project.id}")
    data = resp.json()
    assert data["progress"] == 0.0
    assert data["total_tasks"] == 0
    assert data["done_tasks"] == 0


def test_progress_with_tasks(client, db, sample_project):
    tasks = [
        Task(project_id=sample_project.id, title="Task 1", status="done"),
        Task(project_id=sample_project.id, title="Task 2", status="done"),
        Task(project_id=sample_project.id, title="Task 3", status="todo"),
        Task(project_id=sample_project.id, title="Task 4", status="in_progress"),
    ]
    db.add_all(tasks)
    db.commit()

    resp = client.get(f"/projects/{sample_project.id}")
    data = resp.json()
    assert data["total_tasks"] == 4
    assert data["done_tasks"] == 2
    assert data["progress"] == 50.0


def test_progress_all_done(client, db, sample_project):
    tasks = [
        Task(project_id=sample_project.id, title="Task A", status="done"),
        Task(project_id=sample_project.id, title="Task B", status="done"),
    ]
    db.add_all(tasks)
    db.commit()

    resp = client.get(f"/projects/{sample_project.id}")
    data = resp.json()
    assert data["total_tasks"] == 2
    assert data["done_tasks"] == 2
    assert data["progress"] == 100.0


def test_progress_excludes_subtasks(client, db, sample_project):
    parent = Task(project_id=sample_project.id, title="Parent", status="todo")
    db.add(parent)
    db.flush()

    child = Task(project_id=sample_project.id, title="Child", status="done", parent_id=parent.id)
    db.add(child)
    db.commit()

    resp = client.get(f"/projects/{sample_project.id}")
    data = resp.json()
    # Only the parent (top-level) counts for progress
    assert data["total_tasks"] == 1
    assert data["done_tasks"] == 0
    assert data["progress"] == 0.0
