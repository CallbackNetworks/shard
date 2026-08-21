def test_list_api_keys_empty(client):
    resp = client.get("/api/api-keys")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_api_key(client):
    resp = client.post("/api/api-keys", json={"name": "My Key", "scopes": ["read", "write"]})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Key"
    assert data["key"].startswith("tdp_")
    assert data["active"] is True
    assert "read" in data["scopes"]
    assert "write" in data["scopes"]
    assert data["id"] is not None


def test_create_api_key_with_project_scope(client, sample_project):
    resp = client.post(
        "/api/api-keys",
        json={
            "name": "Project Key",
            "scopes": ["read"],
            "container_id": sample_project.id,
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["container_id"] == sample_project.id
    assert data["scopes"] == ["read"]


def test_create_api_key_with_identity_scope(client, sample_identity):
    resp = client.post(
        "/api/api-keys",
        json={
            "name": "Identity Key",
            "scopes": ["read"],
            "container_id": sample_identity.id,
        },
    )
    assert resp.status_code == 201
    assert resp.json()["container_id"] == sample_identity.id


def test_create_api_key_rejects_non_container(client, db):
    from app.services import graph

    task = graph.create_task(db, title="Not a container")
    db.commit()
    resp = client.post(
        "/api/api-keys",
        json={"name": "Bad Scope", "scopes": ["read"], "container_id": task.id},
    )
    assert resp.status_code == 422


def test_list_shows_key_preview(client):
    create_resp = client.post("/api/api-keys", json={"name": "Preview Key", "scopes": ["read"]})
    assert create_resp.status_code == 201
    raw_key = create_resp.json()["key"]
    last4 = raw_key[-4:]

    list_resp = client.get("/api/api-keys")
    assert list_resp.status_code == 200
    keys = list_resp.json()
    assert len(keys) == 1
    # key_preview should contain the last 4 chars but not the full key
    assert last4 in keys[0]["key_preview"]
    assert "key" not in keys[0] or keys[0].get("key") is None


def test_update_api_key_deactivate(client):
    create_resp = client.post("/api/api-keys", json={"name": "Active Key", "scopes": ["read", "write"]})
    key_id = create_resp.json()["id"]

    resp = client.patch(f"/api/api-keys/{key_id}", json={"active": False})
    assert resp.status_code == 200
    assert resp.json()["active"] is False


def test_delete_api_key(client):
    create_resp = client.post("/api/api-keys", json={"name": "Doomed Key", "scopes": ["read"]})
    key_id = create_resp.json()["id"]

    resp = client.delete(f"/api/api-keys/{key_id}")
    assert resp.status_code == 204

    # Confirm it's gone
    list_resp = client.get("/api/api-keys")
    assert all(k["id"] != key_id for k in list_resp.json())


def test_create_api_key_missing_name(client):
    resp = client.post("/api/api-keys", json={"scopes": ["read"]})
    assert resp.status_code == 422


def test_create_multiple_keys(client):
    client.post("/api/api-keys", json={"name": "Key A", "scopes": ["read"]})
    client.post("/api/api-keys", json={"name": "Key B", "scopes": ["write"]})
    client.post("/api/api-keys", json={"name": "Key C", "scopes": ["read", "admin"]})

    resp = client.get("/api/api-keys")
    assert resp.status_code == 200
    keys = resp.json()
    assert len(keys) == 3
    names = {k["name"] for k in keys}
    assert names == {"Key A", "Key B", "Key C"}
