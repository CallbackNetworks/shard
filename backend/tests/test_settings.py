"""Tests for the settings router and runtime-adjustable system settings."""

import tomllib

import pytest

from app import version as version_mod
from app.services.errors import Unprocessable
from app.services.runtime_settings import get_system_settings, update_system_settings


class TestGetSettings:
    def test_returns_effective_runtime_values(self, client):
        resp = client.get("/api/settings")
        assert resp.status_code == 200
        body = resp.json()
        # Runtime settings surface with env/defaults
        assert body["summary_hour"] == 8
        assert body["due_soon_window_hours"] == 24
        assert body["reminder_cooldown_hours"] == 23
        assert "auth_enabled" in body
        assert "mcp_transport" in body


class TestTheInstanceSaysWhichVersionItIs:
    """ADR-0136. A self-hoster's bug report starts with a version, and until this existed
    nothing served one: the number sat in pyproject.toml and reached no runtime surface."""

    def test_settings_reports_the_version_pyproject_declares(self, client):
        with version_mod.PYPROJECT.open("rb") as fh:
            declared = tomllib.load(fh)["project"]["version"]

        assert client.get("/api/settings").json()["version"] == declared

    def test_an_unreadable_pyproject_does_not_fail_the_request(self, monkeypatch, tmp_path):
        """A version string is a support convenience. A build that cannot read its own
        metadata reports `unknown` rather than turning every settings read into a 500."""
        version_mod.version.cache_clear()
        monkeypatch.setattr(version_mod, "PYPROJECT", tmp_path / "gone.toml")
        try:
            assert version_mod.version() == version_mod.UNKNOWN
        finally:
            version_mod.version.cache_clear()


class TestUpdateSystemSettings:
    def test_update_persists_and_is_reflected(self, client):
        resp = client.put("/api/settings/system", json={"summary_hour": 6, "due_soon_window_hours": 48})
        assert resp.status_code == 200
        assert resp.json()["summary_hour"] == 6
        assert resp.json()["due_soon_window_hours"] == 48

        # GET reflects the override; unset field keeps its default
        body = client.get("/api/settings").json()
        assert body["summary_hour"] == 6
        assert body["due_soon_window_hours"] == 48
        assert body["reminder_cooldown_hours"] == 23

    def test_out_of_range_values_are_refused_not_clamped(self, client):
        """These used to be clamped and answered 200 with a value nobody asked for (ADR-0091)."""
        before = client.get("/api/settings").json()
        resp = client.put("/api/settings/system", json={"summary_hour": 99, "due_soon_window_hours": 0})
        assert resp.status_code == 422
        assert "between 0 and 23" in resp.json()["detail"]
        assert client.get("/api/settings").json() == before

    def test_partial_update_leaves_others(self, client):
        client.put("/api/settings/system", json={"summary_hour": 10})
        client.put("/api/settings/system", json={"due_soon_window_hours": 12})
        body = client.get("/api/settings").json()
        assert body["summary_hour"] == 10
        assert body["due_soon_window_hours"] == 12


class TestRuntimeSettingsService:
    def test_defaults_when_unset(self, db):
        assert get_system_settings(db) == {
            "summary_hour": 8,
            "due_soon_window_hours": 24,
            "reminder_cooldown_hours": 23,
            "backup_enabled": 1,
            "backup_hour": 3,
            "backup_keep": 7,
        }

    def test_refuses_unknown_keys(self, db):
        """A misspelled setting used to be dropped in silence — a 200 for a change that
        never happened, which is the same defect as the clamp (ADR-0091)."""
        with pytest.raises(Unprocessable):
            update_system_settings(db, {"bogus": 5, "summary_hour": 9})
        assert get_system_settings(db)["summary_hour"] != 9
