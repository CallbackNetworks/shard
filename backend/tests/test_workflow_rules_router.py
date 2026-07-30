import pytest

from app.services import graph
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
    r = client.get("/api/workflow-rules")
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create a rule ---


def test_create_rule(client):
    r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Auto-prioritize",
            "trigger": "node.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
            "active": True,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Auto-prioritize"
    assert data["trigger"] == "node.created"
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
        "/api/workflow-rules",
        json={
            "name": "Project-scoped rule",
            "project_id": sample_project.id,
            "trigger": "task.status_changed",
            "conditions": [],
            # Was "urgent" before ADR-0047 — no such priority exists, so the rule was
            # accepted and then did nothing; the value enum now rejects it at write time.
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["project_id"] == sample_project.id
    assert data["name"] == "Project-scoped rule"


# --- 4. Get a single rule ---


def test_get_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Fetch me",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "in_progress"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.get(f"/api/workflow-rules/{rule_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == rule_id
    assert data["name"] == "Fetch me"


# --- 5. Update a rule (change name and actions) ---


def test_update_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "Original name",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(
        f"/api/workflow-rules/{rule_id}",
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
        "/api/workflow-rules",
        json={
            "name": "Active rule",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_status", "value": "done"}],
            "active": True,
        },
    )
    rule_id = create_r.json()["id"]

    r = client.patch(f"/api/workflow-rules/{rule_id}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


# --- 7. Delete a rule ---


def test_delete_rule(client):
    create_r = client.post(
        "/api/workflow-rules",
        json={
            "name": "To Delete",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "medium"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.delete(f"/api/workflow-rules/{rule_id}")
    assert r.status_code == 204

    listing = client.get("/api/workflow-rules")
    assert len(listing.json()) == 0


# --- 8. Get nonexistent rule returns 404 ---


def test_get_nonexistent_rule(client):
    r = client.get("/api/workflow-rules/nonexistent-id")
    assert r.status_code == 404


# --- 9. List rules filtered by project_id ---


def test_list_rules_filter_project(client, sample_project):
    # Create a global rule (no project_id)
    client.post(
        "/api/workflow-rules",
        json={
            "name": "Global rule",
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "low"}],
        },
    )
    # Create a project-scoped rule
    client.post(
        "/api/workflow-rules",
        json={
            "name": "Project rule",
            "project_id": sample_project.id,
            "trigger": "node.created",
            "conditions": [],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )

    # Filter by project_id should return both the project-scoped rule and global rules
    r = client.get(f"/api/workflow-rules?project_id={sample_project.id}")
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
        "/api/workflow-rules",
        json={
            "name": "Match todo tasks",
            "trigger": "node.created",
            "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
            "actions": [{"type": "set_priority", "value": "high"}],
        },
    )
    rule_id = create_r.json()["id"]

    r = client.post(f"/api/workflow-rules/{rule_id}/test?task_id={task.id}")
    assert r.status_code == 200
    data = r.json()
    assert data["would_fire"] is True
    assert data["conditions_met"] == [True]
    assert len(data["actions"]) == 1
    assert data["actions"][0]["type"] == "set_priority"
    assert data["actions"][0]["value"] == "high"


# --- Vocabulary validation (a typo used to save a rule that silently never fired) ---


def _rule_body(**overrides):
    body = {
        "name": "R",
        "trigger": "node.created",
        "conditions": [{"field": "status", "op": "eq", "value": "todo"}],
        "actions": [{"type": "set_priority", "value": "high"}],
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    "body",
    [
        _rule_body(conditions=[{"field": "title", "op": "contains", "value": "x"}]),
        _rule_body(conditions=[{"field": "status", "op": "equals", "value": "todo"}]),
        _rule_body(actions=[{"type": "set_field", "value": "high"}]),
        _rule_body(trigger="task.exploded"),
    ],
    ids=["unknown-field", "unknown-op", "unknown-action", "unknown-trigger"],
)
def test_create_rejects_unknown_vocabulary(client, body):
    assert client.post("/api/workflow-rules", json=body).status_code == 422


def test_patch_rejects_unknown_vocabulary(client):
    rule_id = client.post("/api/workflow-rules", json=_rule_body()).json()["id"]

    r = client.patch(
        f"/api/workflow-rules/{rule_id}",
        json={"conditions": [{"field": "label", "op": "eq", "value": "x"}]},
    )
    assert r.status_code == 422


def test_error_names_the_allowed_values(client):
    r = client.post("/api/workflow-rules", json=_rule_body(actions=[{"type": "set_field", "value": "high"}]))
    assert "set_priority" in r.text


def test_dry_run_sees_labels(client, db, sample_project):
    # has_label needs a session the engine cannot get from a TaskView, so the dry-run
    # used to report every label condition as unmet (ADR-0045).
    task = _make_task(db, sample_project.id)
    label = graph.create_label(db, sample_project.id, name="urgent", color="#f00")
    graph.set_label(db, task.id, label.id)
    db.commit()

    rule_id = client.post(
        "/api/workflow-rules",
        json=_rule_body(conditions=[{"field": "has_label", "op": "eq", "value": "urgent"}]),
    ).json()["id"]

    data = client.post(f"/api/workflow-rules/{rule_id}/test?task_id={task.id}").json()
    assert data["conditions_met"] == [True]
    assert data["would_fire"] is True
