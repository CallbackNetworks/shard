from app.models import Project, Task


def test_search_empty(client, sample_project):
    resp = client.get("/search", params={"q": "nonexistent"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["tasks"] == []
    assert data["projects"] == []


def test_search_finds_task(client, db, sample_project):
    t = Task(project_id=sample_project.id, title="Deploy to production", status="todo")
    db.add(t)
    db.commit()

    resp = client.get("/search", params={"q": "Deploy"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tasks"]) == 1
    assert data["tasks"][0]["title"] == "Deploy to production"


def test_search_finds_project(client, sample_project):
    resp = client.get("/search", params={"q": "Test Project"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["projects"]) >= 1
    names = [p["name"] for p in data["projects"]]
    assert "Test Project" in names


def test_search_case_insensitive(client, db, sample_project):
    t = Task(project_id=sample_project.id, title="URGENT BUG FIX", status="todo")
    db.add(t)
    db.commit()

    resp = client.get("/search", params={"q": "urgent bug"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tasks"]) == 1
    assert data["tasks"][0]["title"] == "URGENT BUG FIX"


def test_search_filter_project(client, db, sample_project):
    other = Project(name="Other Project")
    db.add(other)
    db.flush()

    t1 = Task(project_id=sample_project.id, title="Task in sample", status="todo")
    t2 = Task(project_id=other.id, title="Task in other", status="todo")
    db.add_all([t1, t2])
    db.commit()

    resp = client.get(
        "/search",
        params={"q": "Task in", "project_id": sample_project.id},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tasks"]) == 1
    assert data["tasks"][0]["title"] == "Task in sample"
    # project search is skipped when project_id is provided
    assert data["projects"] == []


def test_search_pagination(client, db, sample_project):
    for i in range(5):
        db.add(Task(project_id=sample_project.id, title=f"Paginate task {i}", status="todo"))
    db.commit()

    # Limit to 2
    resp = client.get("/search", params={"q": "Paginate task", "limit": 2})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tasks"]) == 2

    # Offset by 3, should get remaining 2
    resp = client.get(
        "/search", params={"q": "Paginate task", "limit": 10, "offset": 3}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["tasks"]) == 2


def test_search_missing_query(client):
    resp = client.get("/search")
    assert resp.status_code == 422


def test_search_returns_structure(client, sample_project):
    resp = client.get("/search", params={"q": "anything"})
    assert resp.status_code == 200
    data = resp.json()
    assert "query" in data
    assert "tasks" in data
    assert "projects" in data
    assert data["query"] == "anything"
    assert isinstance(data["tasks"], list)
    assert isinstance(data["projects"], list)
