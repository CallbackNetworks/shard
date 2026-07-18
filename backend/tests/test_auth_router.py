"""Tests for the auth router."""

import time

import app.routers.auth as auth_mod


def _enable_auth(pw="secret123"):
    """Temporarily enable password auth. Returns state to restore."""
    state = (auth_mod.AUTH_PASSWORD, auth_mod.AUTH_PROXY_HEADER, dict(auth_mod._failed_attempts))
    auth_mod.AUTH_PASSWORD = pw
    auth_mod.AUTH_PROXY_HEADER = ""
    auth_mod._failed_attempts.clear()
    return state


def _enable_proxy(header="X-Auth-Request-Email"):
    state = (auth_mod.AUTH_PASSWORD, auth_mod.AUTH_PROXY_HEADER, dict(auth_mod._failed_attempts))
    auth_mod.AUTH_PASSWORD = ""
    auth_mod.AUTH_PROXY_HEADER = header
    auth_mod._failed_attempts.clear()
    return state


def _restore_auth(state):
    auth_mod.AUTH_PASSWORD, auth_mod.AUTH_PROXY_HEADER, failed = state
    auth_mod._failed_attempts.clear()
    auth_mod._failed_attempts.update(failed)


def test_login_no_auth_configured(client):
    r = client.post("/api/auth/login", json={"password": "anything"})
    assert r.status_code == 200
    data = r.json()
    assert data["token"] == "no-auth"
    assert data["auth_required"] is False


def test_me_no_auth_configured(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["auth_required"] is False


def test_login_correct_password(client):
    state = _enable_auth()
    try:
        r = client.post("/api/auth/login", json={"password": "secret123"})
        assert r.status_code == 200
        data = r.json()
        assert data["auth_required"] is True
        assert data["token"].count(".") == 2
    finally:
        _restore_auth(state)


def test_login_generates_unique_tokens(client):
    state = _enable_auth()
    try:
        r1 = client.post("/api/auth/login", json={"password": "secret123"})
        r2 = client.post("/api/auth/login", json={"password": "secret123"})
        assert r1.json()["token"] != r2.json()["token"]
    finally:
        _restore_auth(state)


def test_login_wrong_password(client):
    state = _enable_auth()
    try:
        r = client.post("/api/auth/login", json={"password": "wrong"})
        assert r.status_code == 401
    finally:
        _restore_auth(state)


def test_me_valid_token(client):
    state = _enable_auth()
    try:
        r = client.post("/api/auth/login", json={"password": "secret123"})
        token = r.json()["token"]
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert r.json()["mode"] == "password"
    finally:
        _restore_auth(state)


def test_me_invalid_token(client):
    state = _enable_auth()
    try:
        r = client.get("/api/auth/me", headers={"Authorization": "Bearer badtoken"})
        assert r.status_code == 401
    finally:
        _restore_auth(state)


def test_logout(client):
    state = _enable_auth()
    try:
        r = client.post("/api/auth/login", json={"password": "secret123"})
        token = r.json()["token"]

        r = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
    finally:
        _restore_auth(state)


def test_password_change_invalidates_tokens(client):
    state = _enable_auth("oldpass")
    try:
        r = client.post("/api/auth/login", json={"password": "oldpass"})
        token = r.json()["token"]

        auth_mod.AUTH_PASSWORD = "newpass"
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
    finally:
        _restore_auth(state)


def test_login_missing_password(client):
    r = client.post("/api/auth/login", json={})
    assert r.status_code == 422


# --- Token expiry -----------------------------------------------------------


def test_expired_token_rejected(client):
    state = _enable_auth()
    try:
        auth_mod.AUTH_TOKEN_TTL = -1  # mint an already-expired token
        r = client.post("/api/auth/login", json={"password": "secret123"})
        token = r.json()["token"]
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
    finally:
        auth_mod.AUTH_TOKEN_TTL = 604800
        _restore_auth(state)


def test_unexpired_token_accepted(client):
    state = _enable_auth()
    try:
        auth_mod.AUTH_TOKEN_TTL = 3600
        r = client.post("/api/auth/login", json={"password": "secret123"})
        token = r.json()["token"]
        # Second segment is a future unix timestamp.
        expiry = int(token.split(".")[1])
        assert expiry > int(time.time())
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
    finally:
        auth_mod.AUTH_TOKEN_TTL = 604800
        _restore_auth(state)


# --- Login throttling -------------------------------------------------------


def test_login_throttled_after_max_attempts(client):
    state = _enable_auth()
    try:
        for _ in range(auth_mod.AUTH_MAX_ATTEMPTS):
            r = client.post("/api/auth/login", json={"password": "wrong"})
            assert r.status_code == 401
        # Next attempt is locked out, even with the correct password.
        r = client.post("/api/auth/login", json={"password": "secret123"})
        assert r.status_code == 429
    finally:
        _restore_auth(state)


def test_login_success_clears_failures(client):
    state = _enable_auth()
    try:
        for _ in range(auth_mod.AUTH_MAX_ATTEMPTS - 1):
            client.post("/api/auth/login", json={"password": "wrong"})
        r = client.post("/api/auth/login", json={"password": "secret123"})
        assert r.status_code == 200
        # Counter reset — a fresh run of wrong attempts is needed to lock out again.
        r = client.post("/api/auth/login", json={"password": "wrong"})
        assert r.status_code == 401
    finally:
        _restore_auth(state)


# --- Forward-auth / trusted proxy mode --------------------------------------


def test_proxy_header_authenticates(client):
    state = _enable_proxy()
    try:
        r = client.get("/api/auth/me", headers={"X-Auth-Request-Email": "user@example.com"})
        assert r.status_code == 200
        data = r.json()
        assert data["mode"] == "proxy"
        assert data["user"] == "user@example.com"
        # SPA needs no login gate when the proxy has authenticated the user.
        assert data["auth_required"] is False
    finally:
        _restore_auth(state)


def test_proxy_header_missing_blocks_gated_route(client):
    state = _enable_proxy()
    try:
        # A gated (non-bypass) route with no proxy header and no password is rejected.
        r = client.get("/api/projects")
        assert r.status_code == 401
    finally:
        _restore_auth(state)


def test_proxy_header_present_allows_gated_route(client):
    state = _enable_proxy()
    try:
        r = client.get("/api/projects", headers={"X-Auth-Request-Email": "user@example.com"})
        assert r.status_code == 200
    finally:
        _restore_auth(state)
