"""Tests for the usage tracking service."""

import time

from app.services.usage_tracker import UsageTracker, _is_uuid, _normalize_path


class TestNormalizePath:
    def test_plain_path(self):
        assert _normalize_path("/projects") == "/projects"

    def test_uuid_replaced(self):
        assert _normalize_path("/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890") == "/projects/:id"

    def test_numeric_replaced(self):
        assert _normalize_path("/items/42") == "/items/:n"

    def test_mixed_segments(self):
        result = _normalize_path("/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890/tasks/b2c3d4e5-f6a7-8901-bcde-f12345678901")
        assert result == "/projects/:id/tasks/:id"

    def test_preserves_non_id_segments(self):
        assert _normalize_path("/analytics/overview") == "/analytics/overview"

    def test_root_path(self):
        assert _normalize_path("/") == "/"


class TestIsUuid:
    def test_valid_uuid(self):
        assert _is_uuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890") is True

    def test_uppercase_uuid(self):
        assert _is_uuid("A1B2C3D4-E5F6-7890-ABCD-EF1234567890") is True

    def test_not_uuid(self):
        assert _is_uuid("hello-world") is False

    def test_numeric_string(self):
        assert _is_uuid("12345") is False


class TestUsageTracker:
    def test_record_and_snapshot(self):
        t = UsageTracker()
        t.record("GET", "/projects", 200, 15.0)
        t.record("GET", "/projects", 200, 25.0)
        t.record("POST", "/projects", 201, 50.0)

        snap = t.snapshot()
        assert len(snap) == 2

        # Sorted by hits descending
        assert snap[0]["method"] == "GET"
        assert snap[0]["path"] == "/projects"
        assert snap[0]["hits"] == 2
        assert snap[0]["avg_ms"] == 20.0
        assert snap[0]["errors"] == 0

        assert snap[1]["method"] == "POST"
        assert snap[1]["hits"] == 1

    def test_errors_counted(self):
        t = UsageTracker()
        t.record("GET", "/missing", 404, 5.0)
        t.record("GET", "/missing", 200, 5.0)
        t.record("POST", "/fail", 500, 10.0)

        snap = t.snapshot()
        get_entry = next(e for e in snap if e["method"] == "GET")
        assert get_entry["errors"] == 1

        post_entry = next(e for e in snap if e["method"] == "POST")
        assert post_entry["errors"] == 1

    def test_last_access_updated(self):
        t = UsageTracker()
        before = time.time()
        t.record("GET", "/test", 200, 1.0)
        after = time.time()

        snap = t.snapshot()
        assert before <= snap[0]["last_access"] <= after

    def test_reset(self):
        t = UsageTracker()
        t.record("GET", "/test", 200, 1.0)
        assert len(t.snapshot()) == 1
        t.reset()
        assert len(t.snapshot()) == 0

    def test_empty_snapshot(self):
        t = UsageTracker()
        assert t.snapshot() == []

    def test_avg_ms_zero_when_no_hits(self):
        from app.services.usage_tracker import RouteStats
        stats = RouteStats()
        assert stats.avg_ms == 0.0
