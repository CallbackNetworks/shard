def test_create_identity(client):
    resp = client.post("/api/identities", json={"name": "New Identity", "color": "#ff0000"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "New Identity"
    assert data["share_token"] is not None


def test_list_identities(client, sample_identity):
    resp = client.get("/api/identities")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert any(i["name"] == "Test User" for i in data)


def test_update_identity(client, sample_identity):
    resp = client.patch(
        f"/api/identities/{sample_identity.id}",
        json={"name": "Updated Name"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


def test_delete_identity(client, sample_identity):
    resp = client.delete(f"/api/identities/{sample_identity.id}")
    assert resp.status_code == 204


def test_set_pin_valid(client, sample_identity):
    resp = client.post(
        f"/api/identities/{sample_identity.id}/set-pin",
        json={"pin": "1234"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_set_pin_too_short(client, sample_identity):
    resp = client.post(
        f"/api/identities/{sample_identity.id}/set-pin",
        json={"pin": "12"},
    )
    assert resp.status_code == 400


def test_set_pin_non_digits(client, sample_identity):
    resp = client.post(
        f"/api/identities/{sample_identity.id}/set-pin",
        json={"pin": "abcd"},
    )
    assert resp.status_code == 400


def test_clear_pin(client, pinned_identity):
    resp = client.delete(f"/api/identities/{pinned_identity.id}/pin")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_rotate_share_token(client, sample_identity):
    old_token = sample_identity.share_token
    resp = client.post(f"/api/identities/{sample_identity.id}/rotate-share-token")
    assert resp.status_code == 200
    assert resp.json()["share_token"] != old_token


def test_link_project(client, sample_identity, db):
    from tests.factories import make_project

    project = make_project(db, name="Link Test")
    db.add(project)
    db.commit()
    db.refresh(project)

    resp = client.post(f"/api/identities/{sample_identity.id}/projects/{project.id}")
    assert resp.status_code == 201


def test_share_view_count(client, sample_identity, sample_project):
    # Access the share page to generate a view log
    client.get(f"/share/identity/{sample_identity.share_token}")

    resp = client.get(f"/api/identities/{sample_identity.id}/share-views")
    assert resp.status_code == 200
    assert resp.json()["view_count"] >= 1
