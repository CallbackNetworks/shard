def test_list_templates_empty(client):
    r = client.get("/api/templates")
    assert r.status_code == 200
    assert r.json() == []


def test_create_template(client):
    r = client.post(
        "/api/templates",
        json={
            "name": "Bug report",
            "priority": "high",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Bug report"
    assert data["priority"] == "high"
    assert data["subtasks"] == []
    assert data["label_names"] == []
    assert data["id"] is not None


def test_create_template_with_subtasks(client):
    r = client.post(
        "/api/templates",
        json={
            "name": "Feature request",
            "priority": "medium",
            "subtasks": [
                {"title": "Design", "priority": "high"},
                {"title": "Implement", "priority": "medium"},
            ],
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Feature request"
    assert len(data["subtasks"]) == 2
    assert data["subtasks"][0]["title"] == "Design"
    assert data["subtasks"][1]["title"] == "Implement"


def test_list_templates_filter_project(client, sample_project):
    # Create a template linked to sample_project
    r1 = client.post(
        "/api/templates",
        json={
            "name": "Project template",
            "priority": "low",
            "project_id": sample_project.id,
        },
    )
    assert r1.status_code == 201

    # Create a global template (no project_id)
    r2 = client.post(
        "/api/templates",
        json={
            "name": "Global template",
            "priority": "medium",
        },
    )
    assert r2.status_code == 201

    # Filter by project_id returns both project-specific and global templates
    r = client.get("/api/templates", params={"project_id": sample_project.id})
    assert r.status_code == 200
    data = r.json()
    names = [t["name"] for t in data]
    assert "Project template" in names
    assert "Global template" in names


def test_update_template(client):
    r = client.post(
        "/api/templates",
        json={
            "name": "Original name",
            "priority": "low",
        },
    )
    assert r.status_code == 201
    tpl_id = r.json()["id"]

    r = client.patch(f"/api/templates/{tpl_id}", json={"name": "Updated name"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated name"


def test_delete_template(client):
    r = client.post(
        "/api/templates",
        json={
            "name": "To delete",
            "priority": "medium",
        },
    )
    assert r.status_code == 201
    tpl_id = r.json()["id"]

    r = client.delete(f"/api/templates/{tpl_id}")
    assert r.status_code == 204

    # Verify it no longer appears in the list
    r = client.get("/api/templates")
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert tpl_id not in ids
