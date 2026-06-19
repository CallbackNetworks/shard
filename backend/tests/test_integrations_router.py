# --- 1. List integrations (empty) ---


def test_list_integrations_empty(client):
    r = client.get("/integrations")
    assert r.status_code == 200
    assert r.json() == []


# --- 2. Create integration (webhook type) ---


def test_create_integration_webhook(client):
    r = client.post(
        "/integrations",
        json={
            "name": "CI Webhook",
            "type": "generic",
            "url": "https://example.com/hook",
            "events": ["task.done"],
            "active": True,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "CI Webhook"
    assert data["type"] == "generic"
    assert data["url"] == "https://example.com/hook"
    assert data["events"] == ["task.done"]
    assert data["active"] is True
    assert "id" in data
    assert "created_at" in data


# --- 3. Create integration (email type, email_to required) ---


def test_create_integration_email(client):
    r = client.post(
        "/integrations",
        json={
            "name": "Email Alerts",
            "type": "email",
            "email_to": "admin@example.com",
            "events": ["task.done", "project.complete"],
            "active": True,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Email Alerts"
    assert data["type"] == "email"
    assert data["email_to"] == "admin@example.com"


# --- 4. List integrations after create ---


def test_list_integrations_after_create(client):
    client.post(
        "/integrations",
        json={
            "name": "Hook A",
            "type": "generic",
            "url": "https://a.example.com",
            "events": ["task.done"],
        },
    )
    client.post(
        "/integrations",
        json={
            "name": "Hook B",
            "type": "generic",
            "url": "https://b.example.com",
            "events": ["task.failed"],
        },
    )
    r = client.get("/integrations")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    names = {i["name"] for i in items}
    assert names == {"Hook A", "Hook B"}


# --- 5. Update integration (change name & events) ---


def test_update_integration(client):
    create_r = client.post(
        "/integrations",
        json={
            "name": "Original",
            "type": "generic",
            "url": "https://example.com",
            "events": ["task.done"],
        },
    )
    iid = create_r.json()["id"]

    r = client.patch(
        f"/integrations/{iid}",
        json={"name": "Renamed", "events": ["task.done", "task.failed"]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Renamed"
    assert data["events"] == ["task.done", "task.failed"]


# --- 6. Deactivate integration ---


def test_update_integration_deactivate(client):
    create_r = client.post(
        "/integrations",
        json={
            "name": "Active Hook",
            "type": "generic",
            "url": "https://example.com",
            "events": ["task.done"],
            "active": True,
        },
    )
    iid = create_r.json()["id"]

    r = client.patch(f"/integrations/{iid}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


# --- 7. Delete integration ---


def test_delete_integration(client):
    create_r = client.post(
        "/integrations",
        json={
            "name": "To Delete",
            "type": "generic",
            "url": "https://example.com",
            "events": ["task.done"],
        },
    )
    iid = create_r.json()["id"]

    r = client.delete(f"/integrations/{iid}")
    assert r.status_code == 204

    listing = client.get("/integrations")
    assert len(listing.json()) == 0


# --- 8. PATCH nonexistent integration returns 404 ---


def test_get_nonexistent_integration(client):
    r = client.patch(
        "/integrations/nonexistent-id",
        json={"name": "Nope"},
    )
    assert r.status_code == 404


# --- 9. List templates ---


def test_list_templates(client):
    r = client.get("/integrations/templates")
    assert r.status_code == 200
    templates = r.json()
    assert isinstance(templates, list)
    assert len(templates) > 0
    # Each template should have basic required fields
    first = templates[0]
    assert "id" in first
    assert "name" in first


# --- 10. Get a specific template ---


def test_get_template(client):
    # First get the list to find a valid template ID
    listing = client.get("/integrations/templates").json()
    template_id = listing[0]["id"]

    r = client.get(f"/integrations/templates/{template_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == template_id
    assert "name" in data


# --- 11. Get nonexistent template returns 404 ---


def test_get_template_not_found(client):
    r = client.get("/integrations/templates/nonexistent-template")
    assert r.status_code == 404


# --- 12. Create integration with template_id ---


def test_create_integration_with_template(client):
    # Get a real template ID
    listing = client.get("/integrations/templates").json()
    template_id = listing[0]["id"]

    r = client.post(
        "/integrations",
        json={
            "name": "Templated Hook",
            "type": "github",
            "url": "https://github.example.com/hook",
            "events": ["task.done"],
            "template_id": template_id,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["template_id"] == template_id
    assert data["name"] == "Templated Hook"
