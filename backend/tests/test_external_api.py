"""Tests for the external API v1 endpoints (API-key authenticated)."""

import hashlib

import pytest

from app.models import ApiKey, Project
from tests.factories import make_task


@pytest.fixture()
def api_key_read(db):
    raw_key = "tdp_test_read_key_123"
    key = ApiKey(
        name="Read Key",
        key=raw_key,
        key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
        key_last4=raw_key[-4:],
        scopes=["read"],
        active=True,
    )
    db.add(key)
    db.commit()
    return raw_key, key


@pytest.fixture()
def api_key_write(db):
    raw_key = "tdp_test_write_key_456"
    key = ApiKey(
        name="Write Key",
        key=raw_key,
        key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
        key_last4=raw_key[-4:],
        scopes=["read", "write"],
        active=True,
    )
    db.add(key)
    db.commit()
    return raw_key, key


@pytest.fixture()
def api_key_admin(db):
    raw_key = "tdp_test_admin_key_789"
    key = ApiKey(
        name="Admin Key",
        key=raw_key,
        key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
        key_last4=raw_key[-4:],
        scopes=["admin"],
        active=True,
    )
    db.add(key)
    db.commit()
    return raw_key, key


@pytest.fixture()
def project_with_tasks(db):
    p = Project(name="Test Project")
    db.add(p)
    db.flush()
    t1 = make_task(db, project_id=p.id, title="Task A", status="done", priority="high")
    t2 = make_task(db, project_id=p.id, title="Task B", status="todo", priority="low")
    db.add_all([t1, t2])
    db.commit()
    db.refresh(p)
    return p, t1, t2


# ── Authentication ───────────────────────────────────────────────────────


class TestApiKeyAuth:
    def test_no_api_key_returns_422(self, client):
        r = client.get("/api/v1/projects")
        assert r.status_code == 422

    def test_invalid_api_key_returns_401(self, client):
        r = client.get("/api/v1/projects", headers={"X-API-Key": "tdp_invalid"})
        assert r.status_code == 401

    def test_inactive_key_returns_401(self, client, db):
        raw_key = "tdp_inactive_key"
        key = ApiKey(
            name="Inactive",
            key=raw_key,
            key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
            key_last4=raw_key[-4:],
            scopes=["read"],
            active=False,
        )
        db.add(key)
        db.commit()

        r = client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        assert r.status_code == 401

    def test_valid_key_returns_200(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        assert r.status_code == 200

    def test_last_used_at_updated(self, client, db, api_key_read):
        raw_key, key_obj = api_key_read
        assert key_obj.last_used_at is None

        client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        db.refresh(key_obj)
        assert key_obj.last_used_at is not None


# ── Scope enforcement ────────────────────────────────────────────────────


class TestScopeEnforcement:
    def test_read_key_can_list_projects(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        assert r.status_code == 200

    def test_read_key_cannot_create_project(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.post(
            "/api/v1/projects",
            json={"name": "New Project"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 403
        assert "write" in r.json()["detail"]

    def test_write_key_can_create_project(self, client, api_key_write):
        raw_key, _ = api_key_write
        r = client.post(
            "/api/v1/projects",
            json={"name": "New Project"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 201

    def test_write_key_cannot_delete_project(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, _, _ = project_with_tasks
        r = client.delete(f"/api/v1/projects/{p.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 403
        assert "admin" in r.json()["detail"]

    def test_admin_key_can_delete_project(self, client, api_key_admin, project_with_tasks):
        raw_key, _ = api_key_admin
        p, _, _ = project_with_tasks
        r = client.delete(f"/api/v1/projects/{p.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 204


# ── Project scoping ──────────────────────────────────────────────────────


class TestProjectScoping:
    def test_scoped_key_only_sees_its_project(self, client, db, project_with_tasks):
        p, _, _ = project_with_tasks
        other = Project(name="Other")
        db.add(other)
        db.flush()

        raw_key = "tdp_scoped_key"
        key = ApiKey(
            name="Scoped",
            key=raw_key,
            key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
            key_last4=raw_key[-4:],
            scopes=["read"],
            active=True,
            project_id=p.id,
        )
        db.add(key)
        db.commit()

        r = client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        projects = r.json()
        assert len(projects) == 1
        assert projects[0]["id"] == p.id

    def test_scoped_key_denied_other_project(self, client, db, project_with_tasks):
        p, _, _ = project_with_tasks
        other = Project(name="Other")
        db.add(other)
        db.commit()

        raw_key = "tdp_scoped_deny"
        key = ApiKey(
            name="Scoped",
            key=raw_key,
            key_hash=hashlib.sha256(raw_key.encode()).hexdigest(),
            key_last4=raw_key[-4:],
            scopes=["read"],
            active=True,
            project_id=p.id,
        )
        db.add(key)
        db.commit()

        r = client.get(f"/api/v1/projects/{other.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 403


# ── Projects CRUD ────────────────────────────────────────────────────────


class TestProjectsCrud:
    def test_list_projects(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/projects", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert "progress" in data[0]
        assert "total_tasks" in data[0]

    def test_get_project(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        p, _, _ = project_with_tasks
        r = client.get(f"/api/v1/projects/{p.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Test Project"
        assert len(data["tasks"]) == 2

    def test_get_project_not_found(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/projects/nonexistent", headers={"X-API-Key": raw_key})
        assert r.status_code == 404

    def test_update_project(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, _, _ = project_with_tasks
        r = client.patch(
            f"/api/v1/projects/{p.id}",
            json={"name": "Updated Name"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 200
        assert r.json()["name"] == "Updated Name"


# ── Tasks CRUD ───────────────────────────────────────────────────────────


class TestTasksCrud:
    def test_list_tasks(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        p, _, _ = project_with_tasks
        r = client.get(f"/api/v1/projects/{p.id}/tasks", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_list_tasks_filter_status(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        p, _, _ = project_with_tasks
        r = client.get(f"/api/v1/projects/{p.id}/tasks?status_filter=done", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        tasks = r.json()
        assert len(tasks) == 1
        assert tasks[0]["status"] == "done"

    def test_create_task(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, _, _ = project_with_tasks
        r = client.post(
            f"/api/v1/projects/{p.id}/tasks",
            json={"title": "New Task", "priority": "medium"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 201
        assert r.json()["title"] == "New Task"

    def test_get_task(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        p, t1, _ = project_with_tasks
        r = client.get(f"/api/v1/projects/{p.id}/tasks/{t1.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        assert r.json()["title"] == "Task A"

    def test_get_task_not_found(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        p, _, _ = project_with_tasks
        r = client.get(f"/api/v1/projects/{p.id}/tasks/nonexistent", headers={"X-API-Key": raw_key})
        assert r.status_code == 404

    def test_delete_task(self, client, api_key_admin, project_with_tasks):
        raw_key, _ = api_key_admin
        p, t1, _ = project_with_tasks
        r = client.delete(f"/api/v1/projects/{p.id}/tasks/{t1.id}", headers={"X-API-Key": raw_key})
        assert r.status_code == 204

    def test_update_task_reparents_via_graph(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, t1, t2 = project_with_tasks
        r = client.patch(
            f"/api/v1/projects/{p.id}/tasks/{t2.id}",
            json={"parent_id": t1.id},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 200
        assert r.json()["parent_id"] == t1.id

    def test_update_task_unknown_parent_rejected(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, t1, _ = project_with_tasks
        r = client.patch(
            f"/api/v1/projects/{p.id}/tasks/{t1.id}",
            json={"parent_id": "no-such-task"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 404

    def test_create_task_unknown_parent_rejected(self, client, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, _, _ = project_with_tasks
        r = client.post(
            f"/api/v1/projects/{p.id}/tasks",
            json={"title": "Orphan", "parent_id": "no-such-task"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 404


# ── Agent Context ────────────────────────────────────────────────────────


class TestRateLimiter:
    def test_rate_limiter_allows_normal_traffic(self):
        from app.services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=5, window_seconds=60)
        for _ in range(5):
            assert limiter.check("test-key") is True

    def test_rate_limiter_blocks_excess(self):
        from app.services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=3, window_seconds=60)
        for _ in range(3):
            limiter.check("test-key")
        assert limiter.check("test-key") is False

    def test_rate_limiter_separate_keys(self):
        from app.services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=2, window_seconds=60)
        limiter.check("key-a")
        limiter.check("key-a")
        assert limiter.check("key-a") is False
        assert limiter.check("key-b") is True


class TestAgentIdTracking:
    def test_create_task_with_agent_id(self, client, db, api_key_write, project_with_tasks):
        raw_key, _ = api_key_write
        p, _, _ = project_with_tasks
        r = client.post(
            f"/api/v1/projects/{p.id}/tasks",
            json={"title": "Agent Task", "priority": "medium"},
            headers={"X-API-Key": raw_key, "X-Agent-Id": "claude-code-session-123"},
        )
        assert r.status_code == 201

        from app.models import ActivityLog

        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.action == "task.created")
            .order_by(ActivityLog.created_at.desc())
            .first()
        )
        assert log is not None
        assert "claude-code-session-123" in log.actor

    def test_create_task_without_agent_id(self, client, db, api_key_write, project_with_tasks):
        raw_key, key = api_key_write
        p, _, _ = project_with_tasks
        r = client.post(
            f"/api/v1/projects/{p.id}/tasks",
            json={"title": "Normal Task", "priority": "low"},
            headers={"X-API-Key": raw_key},
        )
        assert r.status_code == 201

        from app.models import ActivityLog

        log = (
            db.query(ActivityLog)
            .filter(ActivityLog.action == "task.created")
            .order_by(ActivityLog.created_at.desc())
            .first()
        )
        assert log is not None
        assert log.actor == f"api:{key.name}"


class TestToolsSchema:
    def test_tools_schema_returns_list(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/tools-schema", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 10

    def test_tools_schema_has_required_fields(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/tools-schema", headers={"X-API-Key": raw_key})
        data = r.json()
        for tool in data:
            assert "name" in tool
            assert "description" in tool
            assert "parameters" in tool
            assert tool["parameters"]["type"] == "object"

    def test_tools_schema_requires_auth(self, client):
        r = client.get("/api/v1/tools-schema")
        assert r.status_code in (401, 422)


class TestAgentContext:
    def test_agent_context_returns_structure(self, client, api_key_read):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/agent-context", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        data = r.json()
        assert "capabilities" in data
        assert "conventions" in data
        assert "projects" in data
        assert "quick_start" in data
        assert "task_statuses" in data["conventions"]
        assert "priorities" in data["conventions"]

    def test_agent_context_lists_active_projects(self, client, db, api_key_read):
        raw_key, _ = api_key_read
        p = Project(name="Active Proj", status="active")
        db.add(p)
        db.commit()

        r = client.get("/api/v1/agent-context", headers={"X-API-Key": raw_key})
        data = r.json()
        names = [proj["name"] for proj in data["projects"]]
        assert "Active Proj" in names


# ── Summary ──────────────────────────────────────────────────────────────


class TestSummary:
    def test_summary_returns_projects(self, client, api_key_read, project_with_tasks):
        raw_key, _ = api_key_read
        r = client.get("/api/v1/summary", headers={"X-API-Key": raw_key})
        assert r.status_code == 200
        data = r.json()
        assert "projects" in data
        assert len(data["projects"]) >= 1
