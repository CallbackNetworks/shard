"""Tests for the auth router."""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def test_login_no_auth_configured(client):
    """When AUTH_PASSWORD is empty, login returns a dummy token."""
    r = client.post("/auth/login", json={"password": "anything"})
    assert r.status_code == 200
    data = r.json()
    assert data["token"] == "no-auth"
    assert data["auth_required"] is False


def test_me_no_auth_configured(client):
    """When AUTH_PASSWORD is empty, /me always succeeds."""
    r = client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["auth_required"] is False


def test_login_correct_password(client):
    with patch.dict(os.environ, {"AUTH_PASSWORD": "secret123"}):
        # Reimport to pick up env change
        import app.routers.auth as auth_mod
        old_pw = auth_mod.AUTH_PASSWORD
        auth_mod.AUTH_PASSWORD = "secret123"
        try:
            r = client.post("/auth/login", json={"password": "secret123"})
            assert r.status_code == 200
            data = r.json()
            assert data["auth_required"] is True
            assert len(data["token"]) == 64  # SHA256 hex
        finally:
            auth_mod.AUTH_PASSWORD = old_pw


def test_login_wrong_password(client):
    import app.routers.auth as auth_mod
    old_pw = auth_mod.AUTH_PASSWORD
    auth_mod.AUTH_PASSWORD = "secret123"
    try:
        r = client.post("/auth/login", json={"password": "wrong"})
        assert r.status_code == 401
    finally:
        auth_mod.AUTH_PASSWORD = old_pw


def test_me_valid_token(client):
    import app.routers.auth as auth_mod
    old_pw = auth_mod.AUTH_PASSWORD
    auth_mod.AUTH_PASSWORD = "secret123"
    try:
        # Login first
        r = client.post("/auth/login", json={"password": "secret123"})
        token = r.json()["token"]

        # Use token to access /me
        r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
    finally:
        auth_mod.AUTH_PASSWORD = old_pw


def test_me_invalid_token(client):
    import app.routers.auth as auth_mod
    old_pw = auth_mod.AUTH_PASSWORD
    auth_mod.AUTH_PASSWORD = "secret123"
    try:
        r = client.get("/auth/me", headers={"Authorization": "Bearer badtoken"})
        assert r.status_code == 401
    finally:
        auth_mod.AUTH_PASSWORD = old_pw


def test_login_missing_password(client):
    r = client.post("/auth/login", json={})
    assert r.status_code == 422
