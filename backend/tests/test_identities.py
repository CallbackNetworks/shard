"""Identity reads + write/share via the generic node surface (ADR-0041 B).

Identity create/update/delete go through ``/api/nodes`` (the write core seeds the
``share_token`` for any shareable type), project links are ``owns`` edges via
``/api/nodes/{id}/edges``, and the share facade uses ``/api/nodes/{id}/share/*``.
The ``/identities`` router keeps only the enriched reads.
"""


def _create_identity(client, name="New Identity", **data):
    return client.post("/api/nodes", json={"type": "identity", "title": name, "data": data})


def test_create_identity_seeds_share_token(client):
    resp = _create_identity(client, "New Identity", color="#ff0000")
    assert resp.status_code == 201
    node = resp.json()
    assert node["title"] == "New Identity"
    # The write core seeds a share_token for the shareable identity type (ADR-0041 B).
    assert node["data"]["share_token"] is not None
    # And it reads back enriched through the identities router.
    listed = client.get("/api/identities").json()
    created = next(i for i in listed if i["name"] == "New Identity")
    assert created["share_token"] == node["data"]["share_token"]


def test_list_identities(client, sample_identity):
    resp = client.get("/api/identities")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert any(i["name"] == "Test User" for i in data)


def test_update_identity(client, sample_identity):
    resp = client.patch(f"/api/nodes/{sample_identity.id}", json={"title": "Updated Name"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Name"
    assert any(i["name"] == "Updated Name" for i in client.get("/api/identities").json())


def test_delete_identity(client, sample_identity):
    resp = client.delete(f"/api/nodes/{sample_identity.id}")
    assert resp.status_code == 204


def test_set_pin_valid(client, sample_identity):
    resp = client.post(f"/api/nodes/{sample_identity.id}/share/set-pin", json={"pin": "1234"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_set_pin_too_short(client, sample_identity):
    resp = client.post(f"/api/nodes/{sample_identity.id}/share/set-pin", json={"pin": "12"})
    assert resp.status_code == 400


def test_set_pin_non_digits(client, sample_identity):
    resp = client.post(f"/api/nodes/{sample_identity.id}/share/set-pin", json={"pin": "abcd"})
    assert resp.status_code == 400


def test_clear_pin(client, pinned_identity):
    resp = client.delete(f"/api/nodes/{pinned_identity.id}/share/pin")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_rotate_share_token(client, sample_identity):
    old_token = sample_identity.share_token
    resp = client.post(f"/api/nodes/{sample_identity.id}/share/rotate-token")
    assert resp.status_code == 200
    assert resp.json()["share_token"] != old_token


def test_link_project(client, sample_identity, db):
    from tests.factories import make_project

    project = make_project(db, name="Link Test")
    db.add(project)
    db.commit()
    db.refresh(project)

    resp = client.post(
        f"/api/nodes/{sample_identity.id}/edges",
        json={"target_id": project.id, "rel_type": "owns"},
    )
    assert resp.status_code == 201
    assert project.id in [p["id"] for p in client.get(f"/api/identities/{sample_identity.id}/projects").json()]


def test_share_view_count(client, sample_identity, sample_project):
    # Access the share page to generate a view log
    client.get(f"/share/node/{sample_identity.share_token}")

    resp = client.get(f"/api/nodes/{sample_identity.id}/share-views")
    assert resp.status_code == 200
    assert resp.json()["view_count"] >= 1
