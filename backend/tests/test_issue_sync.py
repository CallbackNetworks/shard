"""Tests for GitHub/GitLab issue sync (inbound webhook + outbound close)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import Integration, Task
from app.routers.issue_sync import sync_task_closure_to_external


class TestNormalization:
    """Unit tests for issue webhook payload normalization."""

    def test_normalize_github_issue_opened(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {
            "action": "opened",
            "issue": {
                "number": 42,
                "html_url": "https://github.com/owner/repo/issues/42",
                "title": "Fix bug",
                "body": "Description here",
                "state": "open",
                "labels": [{"name": "bug"}],
                "assignee": {"login": "devuser"},
            },
            "repository": {"full_name": "owner/repo"},
        }
        result = normalize_github_issue(payload)
        assert result is not None
        assert result["provider"] == "github"
        assert result["external_id"] == "42"
        assert result["title"] == "Fix bug"
        assert result["status"] == "todo"
        assert result["assignee"] == "devuser"
        assert result["repo"] == "owner/repo"
        assert "bug" in result["labels"]

    def test_normalize_github_issue_closed(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {
            "action": "closed",
            "issue": {
                "number": 42,
                "html_url": "https://github.com/owner/repo/issues/42",
                "title": "Fix bug",
                "body": None,
                "state": "closed",
                "labels": [],
                "assignee": None,
            },
            "repository": {"full_name": "owner/repo"},
        }
        result = normalize_github_issue(payload)
        assert result["status"] == "done"
        assert result["assignee"] is None
        assert result["description"] == ""

    def test_normalize_github_issue_in_progress(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {
            "action": "labeled",
            "issue": {
                "number": 10,
                "html_url": "https://github.com/o/r/issues/10",
                "title": "WIP task",
                "body": "",
                "state": "open",
                "labels": [{"name": "In Progress"}],
                "assignee": None,
            },
            "repository": {"full_name": "o/r"},
        }
        result = normalize_github_issue(payload)
        assert result["status"] == "in_progress"

    def test_normalize_github_no_issue(self):
        from app.services.issue_sync import normalize_github_issue

        assert normalize_github_issue({"action": "opened"}) is None

    def test_normalize_gitlab_issue(self):
        from app.services.issue_sync import normalize_gitlab_issue

        payload = {
            "event_type": "issue",
            "object_attributes": {
                "action": "open",
                "iid": 7,
                "id": 100,
                "url": "https://gitlab.com/group/proj/-/issues/7",
                "title": "GL Issue",
                "description": "desc",
                "state": "opened",
            },
            "labels": [{"title": "Doing"}],
            "assignees": [{"username": "gluser"}],
            "project": {"path_with_namespace": "group/proj"},
        }
        result = normalize_gitlab_issue(payload)
        assert result is not None
        assert result["provider"] == "gitlab"
        assert result["external_id"] == "7"
        assert result["status"] == "in_progress"
        assert result["assignee"] == "gluser"

    def test_normalize_gitlab_no_attrs(self):
        from app.services.issue_sync import normalize_gitlab_issue

        assert normalize_gitlab_issue({}) is None

    def test_detect_github(self):
        from app.services.issue_sync import detect_issue_webhook

        headers = {"x-github-event": "issues"}
        payload = {
            "action": "opened",
            "issue": {"number": 1, "title": "t", "state": "open", "labels": []},
            "repository": {"full_name": "o/r"},
        }
        result = detect_issue_webhook(headers, payload)
        assert result is not None
        assert result["provider"] == "github"

    def test_detect_gitlab(self):
        from app.services.issue_sync import detect_issue_webhook

        headers = {"x-gitlab-event": "Issue Hook"}
        payload = {
            "object_attributes": {"action": "open", "iid": 1, "title": "t", "state": "opened"},
            "labels": [],
            "project": {"path_with_namespace": "g/p"},
        }
        result = detect_issue_webhook(headers, payload)
        assert result is not None
        assert result["provider"] == "gitlab"

    def test_detect_unknown(self):
        from app.services.issue_sync import detect_issue_webhook

        assert detect_issue_webhook({}, {}) is None


class TestInboundWebhook:
    """Integration tests for the issue webhook endpoint."""

    def test_github_creates_task(self, client, sample_project):
        payload = {
            "action": "opened",
            "issue": {
                "number": 99,
                "html_url": "https://github.com/test/repo/issues/99",
                "title": "New Feature Request",
                "body": "Please add this",
                "state": "open",
                "labels": [],
                "assignee": None,
            },
            "repository": {"full_name": "test/repo"},
        }
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "created"
        assert data["task_id"] is not None

    def test_github_updates_existing_task(self, client, sample_project, db):
        task = Task(
            project_id=sample_project.id,
            title="Existing",
            external_provider="github",
            external_id="55",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        payload = {
            "action": "edited",
            "issue": {
                "number": 55,
                "html_url": "https://github.com/test/repo/issues/55",
                "title": "Updated Title",
                "body": "Updated body",
                "state": "open",
                "labels": [],
                "assignee": None,
            },
            "repository": {"full_name": "test/repo"},
        }
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "updated"
        db.refresh(task)
        assert task.title == "Updated Title"

    def test_github_closes_task(self, client, sample_project, db):
        task = Task(
            project_id=sample_project.id,
            title="Open task",
            external_provider="github",
            external_id="77",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()

        payload = {
            "action": "closed",
            "issue": {
                "number": 77,
                "html_url": "https://github.com/test/repo/issues/77",
                "title": "Open task",
                "body": "",
                "state": "closed",
                "labels": [],
                "assignee": None,
            },
            "repository": {"full_name": "test/repo"},
        }
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        db.refresh(task)
        assert task.status == "done"

    def test_gitlab_creates_task(self, client, sample_project):
        payload = {
            "event_type": "issue",
            "object_attributes": {
                "action": "open",
                "iid": 3,
                "url": "https://gitlab.com/g/p/-/issues/3",
                "title": "GL Task",
                "description": "GL desc",
                "state": "opened",
            },
            "labels": [],
            "project": {"path_with_namespace": "g/p"},
        }
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-gitlab-event": "Issue Hook"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "created"

    def test_non_issue_event_ignored(self, client, sample_project):
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json={"action": "push"},
            headers={"x-github-event": "push"},
        )
        assert r.status_code == 200
        assert r.json()["detail"] == "Ignored (not an issue event)"

    def test_project_not_found(self, client):
        r = client.post(
            "/webhook/issues/nonexistent",
            json={},
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 404

    def test_delete_action(self, client, sample_project, db):
        task = Task(
            project_id=sample_project.id,
            title="To delete",
            external_provider="github",
            external_id="88",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        task_id = task.id

        payload = {
            "action": "deleted",
            "issue": {
                "number": 88,
                "html_url": "https://github.com/test/repo/issues/88",
                "title": "To delete",
                "body": "",
                "state": "open",
                "labels": [],
                "assignee": None,
            },
            "repository": {"full_name": "test/repo"},
        }
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "deleted"
        assert db.query(Task).filter(Task.id == task_id).first() is None


class TestOutboundSync:
    """Tests for outbound issue closure when tasks are completed."""

    @pytest.mark.asyncio
    async def test_sync_closure_no_external(self, client, sample_project, db):
        task = Task(project_id=sample_project.id, title="Normal task")
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is False

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.close_github_issue", new_callable=AsyncMock, return_value=True)
    async def test_sync_closure_github(self, mock_close, client, sample_project, db):
        integration = Integration(
            name="github-sync",
            type="issue_sync",
            url="https://github.com",
            project_id=sample_project.id,
            secret="ghp_testtoken123",
            active=True,
        )
        db.add(integration)

        task = Task(
            project_id=sample_project.id,
            title="External task",
            external_provider="github",
            external_id="42",
            external_repo="owner/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is True
        mock_close.assert_called_once_with("owner/repo", "42", "ghp_testtoken123")

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.close_gitlab_issue", new_callable=AsyncMock, return_value=True)
    async def test_sync_closure_gitlab(self, mock_close, client, sample_project, db):
        integration = Integration(
            name="gitlab-sync",
            type="issue_sync",
            url="https://gitlab.example.com",
            project_id=sample_project.id,
            secret="glpat-testtoken",
            active=True,
        )
        db.add(integration)

        task = Task(
            project_id=sample_project.id,
            title="GL task",
            external_provider="gitlab",
            external_id="7",
            external_repo="group/proj",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is True
        mock_close.assert_called_once_with("group/proj", "7", "glpat-testtoken", "https://gitlab.example.com")

    @pytest.mark.asyncio
    async def test_sync_closure_no_integration(self, client, sample_project, db):
        task = Task(
            project_id=sample_project.id,
            title="Orphan external",
            external_provider="github",
            external_id="99",
            external_repo="owner/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is False
