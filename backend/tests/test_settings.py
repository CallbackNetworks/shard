"""Tests for the settings router and runtime-adjustable system settings."""

from app.services.runtime_settings import get_system_settings, update_system_settings


class TestGetSettings:
    def test_returns_effective_runtime_values(self, client):
        resp = client.get("/settings")
        assert resp.status_code == 200
        body = resp.json()
        # Runtime settings surface with env/defaults
        assert body["summary_hour"] == 8
        assert body["due_soon_window_hours"] == 24
        assert body["reminder_cooldown_hours"] == 23
        assert "auth_enabled" in body
        assert "mcp_transport" in body


class TestUpdateSystemSettings:
    def test_update_persists_and_is_reflected(self, client):
        resp = client.put("/settings/system", json={"summary_hour": 6, "due_soon_window_hours": 48})
        assert resp.status_code == 200
        assert resp.json()["summary_hour"] == 6
        assert resp.json()["due_soon_window_hours"] == 48

        # GET reflects the override; unset field keeps its default
        body = client.get("/settings").json()
        assert body["summary_hour"] == 6
        assert body["due_soon_window_hours"] == 48
        assert body["reminder_cooldown_hours"] == 23

    def test_values_are_clamped(self, client):
        resp = client.put("/settings/system", json={"summary_hour": 99, "due_soon_window_hours": 0})
        assert resp.status_code == 200
        body = resp.json()
        assert body["summary_hour"] == 23  # clamped to max
        assert body["due_soon_window_hours"] == 1  # clamped to min

    def test_partial_update_leaves_others(self, client):
        client.put("/settings/system", json={"summary_hour": 10})
        client.put("/settings/system", json={"due_soon_window_hours": 12})
        body = client.get("/settings").json()
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

    def test_ignores_unknown_keys(self, db):
        result = update_system_settings(db, {"bogus": 5, "summary_hour": 9})
        assert "bogus" not in result
        assert result["summary_hour"] == 9
