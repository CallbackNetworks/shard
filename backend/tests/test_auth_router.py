"""Tests for the auth router."""


def _enable_auth(pw="secret123"):
    """Temporarily enable auth with a password."""
    import app.routers.auth as auth_mod

    old_pw = auth_mod.AUTH_PASSWORD
    auth_mod.AUTH_PASSWORD = pw
    auth_mod._active_tokens.clear()
    return old_pw


def _restore_auth(old_pw):
    import app.routers.auth as auth_mod

    auth_mod.AUTH_PASSWORD = old_pw
    auth_mod._active_tokens.clear()


def test_login_no_auth_configured(client):
    r = client.post("/auth/login", json={"password": "anything"})
    assert r.status_code == 200
    data = r.json()
    assert data["token"] == "no-auth"
    assert data["auth_required"] is False


def test_me_no_auth_configured(client):
    r = client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["auth_required"] is False


def test_login_correct_password(client):
    old_pw = _enable_auth()
    try:
        r = client.post("/auth/login", json={"password": "secret123"})
        assert r.status_code == 200
        data = r.json()
        assert data["auth_required"] is True
        assert len(data["token"]) == 64  # secrets.token_hex(32) produces 64 hex chars
    finally:
        _restore_auth(old_pw)


def test_login_generates_unique_tokens(client):
    old_pw = _enable_auth()
    try:
        r1 = client.post("/auth/login", json={"password": "secret123"})
        r2 = client.post("/auth/login", json={"password": "secret123"})
        assert r1.json()["token"] != r2.json()["token"]
    finally:
        _restore_auth(old_pw)


def test_login_wrong_password(client):
    old_pw = _enable_auth()
    try:
        r = client.post("/auth/login", json={"password": "wrong"})
        assert r.status_code == 401
    finally:
        _restore_auth(old_pw)


def test_me_valid_token(client):
    old_pw = _enable_auth()
    try:
        r = client.post("/auth/login", json={"password": "secret123"})
        token = r.json()["token"]
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
    finally:
        _restore_auth(old_pw)


def test_me_invalid_token(client):
    old_pw = _enable_auth()
    try:
        r = client.get("/auth/me", headers={"Authorization": "Bearer badtoken"})
        assert r.status_code == 401
    finally:
        _restore_auth(old_pw)


def test_logout(client):
    old_pw = _enable_auth()
    try:
        r = client.post("/auth/login", json={"password": "secret123"})
        token = r.json()["token"]

        # Logout
        r = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # Token should no longer work
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
    finally:
        _restore_auth(old_pw)


def test_login_missing_password(client):
    r = client.post("/auth/login", json={})
    assert r.status_code == 422
