"""An integration's credentials never leave the server, and editing one cannot lose them.

ADR-0063. The read side is the leak that prompted it; the write side is the trap the fix
opens if the two halves disagree, so both are pinned here together.
"""

from app.models import Integration

CREDENTIALS = {
    "name": "Signed hook",
    "type": "webhook",
    "url": "https://example.com/hook",
    "secret": "hmac-signing-key",
    "auth_type": "basic",
    "auth_config": {"username": "alice", "password": "s3cret"},
    "custom_headers": {"X-Api-Token": "tok-abc", "X-Environment": "production"},
    "events": ["task.done"],
}


def _create(client, **overrides):
    r = client.post("/api/integrations", json={**CREDENTIALS, **overrides})
    assert r.status_code == 201, r.text
    return r.json()


def _stored(db, integration_id):
    return db.query(Integration).filter(Integration.id == integration_id).one()


# --- Reading ---


def test_secret_is_never_serialised(client):
    created = _create(client)
    listed = client.get("/api/integrations").json()[0]

    for payload in (created, listed):
        assert "secret" not in payload
        assert payload["secret_set"] is True


def test_secret_set_is_false_without_one(client):
    assert _create(client, secret=None)["secret_set"] is False


def test_auth_config_withholds_the_password_and_keeps_the_username(client):
    auth = _create(client)["auth_config"]

    # Present-and-null says "set but withheld"; the username is configuration, not a
    # credential, and has to stay readable or it cannot be edited.
    assert auth == {"username": "alice", "password": None}


def test_custom_header_values_are_all_withheld(client):
    # Nothing here can tell a token from an environment name, so neither is served.
    assert _create(client)["custom_headers"] == {"X-Api-Token": None, "X-Environment": None}


def test_no_credential_appears_anywhere_in_the_response_body(client):
    _create(client)
    body = client.get("/api/integrations").text

    for leaked in ("hmac-signing-key", "s3cret", "tok-abc"):
        assert leaked not in body


# --- Writing back what you read ---


def test_editing_a_username_keeps_the_password_it_never_saw(client, db):
    created = _create(client)

    edited = dict(created["auth_config"], username="bob")
    r = client.patch(f"/api/integrations/{created['id']}", json={"auth_config": edited})
    assert r.status_code == 200

    stored = _stored(db, created["id"])
    assert stored.auth_config == {"username": "bob", "password": "s3cret"}


def test_saving_untouched_custom_headers_keeps_their_values(client, db):
    created = _create(client)

    r = client.patch(f"/api/integrations/{created['id']}", json={"custom_headers": created["custom_headers"]})
    assert r.status_code == 200

    stored = _stored(db, created["id"])
    assert stored.custom_headers == {"X-Api-Token": "tok-abc", "X-Environment": "production"}


def test_an_omitted_secret_leaves_the_stored_one_alone(client, db):
    created = _create(client)

    client.patch(f"/api/integrations/{created['id']}", json={"name": "Renamed"})

    stored = _stored(db, created["id"])
    assert stored.name == "Renamed"
    assert stored.secret == "hmac-signing-key"


# --- Changing and clearing, which must still work ---


def test_a_new_value_replaces_the_withheld_one(client, db):
    created = _create(client)

    client.patch(
        f"/api/integrations/{created['id']}",
        json={"secret": "rotated", "auth_config": {"username": "alice", "password": "new-pw"}},
    )

    stored = _stored(db, created["id"])
    assert stored.secret == "rotated"
    assert stored.auth_config["password"] == "new-pw"


def test_an_empty_string_clears_a_credential(client, db):
    created = _create(client)

    client.patch(
        f"/api/integrations/{created['id']}",
        json={"secret": "", "auth_config": {"username": "alice", "password": ""}},
    )

    stored = _stored(db, created["id"])
    assert stored.secret == ""
    assert stored.auth_config["password"] == ""


def test_dropping_a_header_key_removes_it(client, db):
    created = _create(client)

    kept = {"X-Environment": None}
    client.patch(f"/api/integrations/{created['id']}", json={"custom_headers": kept})

    stored = _stored(db, created["id"])
    assert stored.custom_headers == {"X-Environment": "production"}


# --- The credentials still have to reach the endpoint they authenticate to ---


def test_withheld_credentials_are_still_sent_on_the_wire(client, db):
    """Redaction is about the read surface only; the notifier must be unaffected."""
    from app.services.notifier import _build_headers

    created = _create(client)
    headers = _build_headers(_stored(db, created["id"]), body_bytes=b"{}")

    assert headers["X-Api-Token"] == "tok-abc"
    assert headers["X-Environment"] == "production"
    assert headers["Authorization"].startswith("Basic ")
    assert "X-Signature" in headers
