from tests.factories import make_task


def _make_task(db, project_id, **overrides):
    defaults = {"project_id": project_id, "title": "Test task", "status": "todo", "priority": "medium"}
    defaults.update(overrides)
    t = make_task(db, **defaults)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# --- 1. List rules (empty) ---


def test_list_rules_empty(client):
    r = client.get("/workflow-rules")
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a rule ---


def test_create_rule(client):
    r = client.post(
        "/workflow-rules",
        json={
            "name": "Auto-prioritize",
            "trigger": "task.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
            "active": True,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Auto-prioritize"
    assert data["trigger"] == "task.created"
    assert data["active"] is True
    assert data["project_id"] is None
    assert len(data["conditions"]) == 1
    assert len(data["actions"]) == 1
    assert data["run_count"] == 0
    assert "id" in data
    assert "created_at" in data


# --- 3. Create a rule with project scope ---


def test_create_rule_with_project_scope(client, sample_project):
    r = client.post(
        "/workflow-rules",
        json={
            "name": "Project-scoped rule",
            "project_id": sample_project.id,
            "trigger": "task.status_changed",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "urgent"}],
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["project_id"] == sample_project.id
    assert data["name"] == "Project-scoped rule"


# --- 4. Get a single rule ---


def test_get_rule(client):
    create_r = client.post(
        "/workflow-rules",
        json={
            "name": "Fetch me",
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "in_progress"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.get(f"/workflow-rules/{rule_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == rule_id
    assert data["name"] == "Fetch me"


# --- 5. Update a rule (change name and actions) ---


def test_update_rule(client):
    create_r = client.post(
        "/workflow-rules",
        json={
            "name": "Original name",
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(
        f"/workflow-rules/{rule_id}",
        json={
            "name": "Updated name",
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated name"
    assert data["actions"][0]["value"] == "high"


# --- 6. Deactivate a rule ---


def test_update_rule_deactivate(client):
    create_r = client.post(
        "/workflow-rules",
        json={
            "name": "Active rule",
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "done"}],
            "active": True,
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(f"/workflow-rules/{rule_id}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


# --- 7. Delete a rule ---


def test_delete_rule(client):
    create_r = client.post(
        "/workflow-rules",
        json={
            "name": "To Delete",
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "medium"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.delete(f"/workflow-rules/{rule_id}")
    assert r.status_code == 204

    listing = client.get("/workflow-rules")
    assert len(listing.json()) == 0


# --- 8. Get nonexistent rule returns 404 ---


def test_get_nonexistent_rule(client):
    r = client.get("/workflow-rules/nonexistent-id")
    assert r.status_code == 404


# --- 9. List rules filtered by project_id ---


def test_list_rules_filter_project(client, sample_project):
    # Create a global rule (no project_id)
    client.post(
        "/workflow-rules",
        json={
            "name": "Global rule",
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    # Create a project-scoped rule
    client.post(
        "/workflow-rules",
        json={
            "name": "Project rule",
            "project_id": sample_project.id,
            "trigger": "task.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )

    # Filter by project_id should return both the project-scoped rule and global rules
    r = client.get(f"/workflow-rules?project_id={sample_project.id}")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    names = {i["name"] for i in items}
    assert "Global rule" in names
    assert "Project rule" in names


# --- 10. Dry-run test a rule against a matching task ---


def test_dry_run_rule(client, db, sample_project):
    task = _make_task(db, sample_project.id, status="todo", priority="medium")

    create_r = client.post(
        "/workflow-rules",
        json={
            "name": "Match todo tasks",
            "trigger": "task.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.post(f"/workflow-rules/{rule_id}/test?task_id={task.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["would_fire"] is True
    assert data["conditions_met"] == [True]
    assert len(data["actions"]) == 1
    assert data["actions"][0]["type"] == "set_priority"
    assert data["actions"][0]["value"] == "high"
