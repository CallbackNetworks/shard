"""Tests for GitHub/GitLab issue sync (inbound webhook + outbound close)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import Integration, Node
from app.routers.issue_sync import sync_task_closure_to_external
from tests.factories import find_task_by_external_id, make_task


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


class TestResolveApiBase:
    """Unit tests for GitHub-compatible API base resolution (github.com / GHE / Gitea)."""

    def test_default_when_empty(self):
        from app.services.issue_sync import resolve_github_api_base

        assert resolve_github_api_base(None, None) == "https://api.github.com"

    def test_github_com_from_external_url(self):
        from app.services.issue_sync import resolve_github_api_base

        assert resolve_github_api_base("https://github.com/owner/repo/issues/1", None) == "https://api.github.com"

    def test_gitea_host_from_external_url(self):
        from app.services.issue_sync import resolve_github_api_base

        result = resolve_github_api_base("https://gitea.example.com/owner/repo/issues/9", None)
        assert result == "https://gitea.example.com/api/v1"

    def test_explicit_api_base_integration_url_wins(self):
        from app.services.issue_sync import resolve_github_api_base

        result = resolve_github_api_base("https://ghe.corp.com/o/r/issues/3", "https://ghe.corp.com/api/v3")
        assert result == "https://ghe.corp.com/api/v3"

    def test_falls_back_to_integration_host(self):
        from app.services.issue_sync import resolve_github_api_base

        result = resolve_github_api_base(None, "https://gitea.internal")
        assert result == "https://gitea.internal/api/v1"


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
        task = make_task(
            db,
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
        task = make_task(
            db,
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
        task = make_task(
            db,
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
        assert db.get(Node, task_id) is None


class TestOutboundSync:
    """Tests for outbound issue closure when tasks are completed."""

    @pytest.mark.asyncio
    async def test_sync_closure_no_external(self, client, sample_project, db):
        task = make_task(db, project_id=sample_project.id, title="Normal task")
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

        task = make_task(
            db,
            project_id=sample_project.id,
            title="External task",
            external_provider="github",
            external_id="42",
            external_repo="owner/repo",
            external_url="https://github.com/owner/repo/issues/42",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is True
        mock_close.assert_called_once_with("owner/repo", "42", "ghp_testtoken123", "https://api.github.com")

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.close_github_issue", new_callable=AsyncMock, return_value=True)
    async def test_sync_closure_gitea(self, mock_close, client, sample_project, db):
        """A Gitea-originated task (github-compatible provider) closes via the Gitea API base."""
        integration = Integration(
            name="gitea-sync",
            type="issue_sync",
            url="https://gitea.example.com",
            project_id=sample_project.id,
            secret="gitea_token",
            active=True,
        )
        db.add(integration)

        task = make_task(
            db,
            project_id=sample_project.id,
            title="Gitea task",
            external_provider="github",
            external_id="5",
            external_repo="owner/repo",
            external_url="https://gitea.example.com/owner/repo/issues/5",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        result = await sync_task_closure_to_external(task, db)
        assert result is True
        mock_close.assert_called_once_with("owner/repo", "5", "gitea_token", "https://gitea.example.com/api/v1")

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

        task = make_task(
            db,
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
        task = make_task(
            db,
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


class TestParseRepoUrl:
    """Unit tests for parse_repo_url provider/repo extraction."""

    def test_github_com(self):
        from app.services.issue_sync import parse_repo_url

        r = parse_repo_url("https://github.com/owner/repo")
        assert r["provider"] == "github"
        assert r["repo"] == "owner/repo"
        assert r["base"] == "https://api.github.com"

    def test_github_strips_git_suffix_and_extra_path(self):
        from app.services.issue_sync import parse_repo_url

        r = parse_repo_url("https://github.com/owner/repo.git")
        assert r["repo"] == "owner/repo"

    def test_gitea_host_uses_api_v1(self):
        from app.services.issue_sync import parse_repo_url

        r = parse_repo_url("https://gitea.example.com/owner/repo")
        assert r["provider"] == "github"
        assert r["base"] == "https://gitea.example.com/api/v1"

    def test_gitlab_detected_and_keeps_namespace(self):
        from app.services.issue_sync import parse_repo_url

        r = parse_repo_url("https://gitlab.com/group/sub/project")
        assert r["provider"] == "gitlab"
        assert r["repo"] == "group/sub/project"
        assert r["base"] == "https://gitlab.com"

    def test_explicit_provider_override(self):
        from app.services.issue_sync import parse_repo_url

        r = parse_repo_url("https://git.example.com/team/app", provider="gitlab")
        assert r["provider"] == "gitlab"
        assert r["repo"] == "team/app"

    def test_invalid_url(self):
        from app.services.issue_sync import parse_repo_url

        assert parse_repo_url("") is None
        assert parse_repo_url("https://github.com/") is None


class TestCreateExternalIssue:
    """The explicit 'create external issue from task' action."""

    def _integration(self, db, project_id, url="https://github.com", secret="ghp_tok"):
        integ = Integration(name="sync", type="issue_sync", url=url, project_id=project_id, secret=secret, active=True)
        db.add(integ)
        db.commit()

    @patch(
        "app.routers.issue_sync.create_github_issue",
        new_callable=AsyncMock,
        return_value={"number": "101", "url": "https://github.com/owner/repo/issues/101"},
    )
    def test_creates_github_issue_and_links_task(self, mock_create, client, db, sample_project):
        sample_project.repo_url = "https://github.com/owner/repo"
        self._integration(db, sample_project.id)
        task = make_task(db, project_id=sample_project.id, title="Ship it", description="body")
        db.add(task)
        db.commit()

        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["external_provider"] == "github"
        assert data["external_id"] == "101"
        assert data["external_url"].endswith("/issues/101")
        assert data["external_repo"] == "owner/repo"
        mock_create.assert_called_once()

    @patch(
        "app.routers.issue_sync.create_gitlab_issue",
        new_callable=AsyncMock,
        return_value={"number": "7", "url": "https://gitlab.com/group/app/-/issues/7"},
    )
    def test_creates_gitlab_issue(self, mock_create, client, db, sample_project):
        sample_project.repo_url = "https://gitlab.com/group/app"
        self._integration(db, sample_project.id, url="https://gitlab.com", secret="glpat")
        task = make_task(db, project_id=sample_project.id, title="GL task")
        db.add(task)
        db.commit()

        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 200, resp.text
        assert resp.json()["external_provider"] == "gitlab"
        assert resp.json()["external_id"] == "7"

    def test_rejects_already_linked(self, client, db, sample_project):
        self._integration(db, sample_project.id)
        sample_project.repo_url = "https://github.com/owner/repo"
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Linked",
            external_provider="github",
            external_id="1",
            external_repo="owner/repo",
        )
        db.add(task)
        db.commit()
        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 409

    def test_rejects_without_integration(self, client, db, sample_project):
        sample_project.repo_url = "https://github.com/owner/repo"
        db.commit()
        task = make_task(db, project_id=sample_project.id, title="No integ")
        db.add(task)
        db.commit()
        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 400

    def test_rejects_without_repo_url(self, client, db, sample_project):
        self._integration(db, sample_project.id)
        task = make_task(db, project_id=sample_project.id, title="No repo")
        db.add(task)
        db.commit()
        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 400

    @patch("app.routers.issue_sync.create_github_issue", new_callable=AsyncMock, return_value=None)
    def test_upstream_failure_returns_502(self, mock_create, client, db, sample_project):
        sample_project.repo_url = "https://github.com/owner/repo"
        self._integration(db, sample_project.id)
        task = make_task(db, project_id=sample_project.id, title="Fails upstream")
        db.add(task)
        db.commit()
        resp = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        assert resp.status_code == 502


class TestDueDateParsing:
    def test_rfc3339_gitea(self):
        from app.services.issue_sync import parse_due_date

        dt = parse_due_date("2026-07-20T00:00:00Z")
        assert dt is not None and dt.year == 2026 and dt.month == 7 and dt.day == 20
        assert dt.tzinfo is not None

    def test_plain_date_gitlab(self):
        from app.services.issue_sync import parse_due_date

        dt = parse_due_date("2026-07-20")
        assert dt is not None and dt.day == 20 and dt.tzinfo is not None

    def test_blank_and_none(self):
        from app.services.issue_sync import parse_due_date

        assert parse_due_date(None) is None
        assert parse_due_date("") is None
        assert parse_due_date("not-a-date") is None


class TestDueDateNormalization:
    def test_github_com_issue_has_no_due_date(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {"action": "opened", "issue": {"number": 1, "title": "x"}, "repository": {"full_name": "o/r"}}
        assert normalize_github_issue(payload)["due_date"] is None

    def test_gitea_issue_due_date(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {
            "action": "edited",
            "issue": {"number": 2, "title": "x", "due_date": "2026-08-01T00:00:00Z"},
            "repository": {"full_name": "o/r"},
        }
        assert normalize_github_issue(payload)["due_date"].month == 8

    def test_gitlab_issue_due_date(self):
        from app.services.issue_sync import normalize_gitlab_issue

        payload = {"object_attributes": {"iid": 3, "title": "x", "due_date": "2026-09-15"}, "project": {}}
        assert normalize_gitlab_issue(payload)["due_date"].day == 15


class TestDueDateOutbound:
    def _integration(self, db, project_id, url, secret):
        db.add(Integration(name="s", type="issue_sync", url=url, project_id=project_id, secret=secret, active=True))
        db.commit()

    def _task(self, db, project_id, provider, repo, url, due):
        from datetime import UTC, datetime

        t = make_task(
            db,
            project_id=project_id,
            title="t",
            external_provider=provider,
            external_id="10",
            external_repo=repo,
            external_url=url,
            due_date=datetime(2026, 7, 20, tzinfo=UTC) if due else None,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return t

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.update_gitlab_issue_fields", new_callable=AsyncMock, return_value=True)
    async def test_gitlab_sends_plain_date(self, mock_update, client, db, sample_project):
        from app.routers.issue_sync import sync_task_fields_to_external

        self._integration(db, sample_project.id, "https://gitlab.com", "glpat")
        task = self._task(
            db, sample_project.id, "gitlab", "group/app", "https://gitlab.com/group/app/-/issues/10", True
        )
        await sync_task_fields_to_external(task, db, {"due_date"})
        args = mock_update.call_args[0]
        assert args[2]["due_date"] == "2026-07-20"

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.update_github_issue_fields", new_callable=AsyncMock, return_value=True)
    async def test_gitea_sends_rfc3339_separately(self, mock_update, client, db, sample_project):
        from app.routers.issue_sync import sync_task_fields_to_external

        self._integration(db, sample_project.id, "https://gitea.example.com", "tok")
        task = self._task(db, sample_project.id, "github", "o/r", "https://gitea.example.com/o/r/issues/10", True)
        await sync_task_fields_to_external(task, db, {"due_date"})
        # Called once with only the due_date field, targeting the Gitea API base.
        mock_update.assert_called_once()
        payload = mock_update.call_args[0][2]
        assert "due_date" in payload and payload["due_date"].startswith("2026-07-20")

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.update_github_issue_fields", new_callable=AsyncMock, return_value=True)
    async def test_github_com_never_sends_due_date(self, mock_update, client, db, sample_project):
        from app.routers.issue_sync import sync_task_fields_to_external

        self._integration(db, sample_project.id, "https://github.com", "ghp")
        task = self._task(db, sample_project.id, "github", "o/r", "https://github.com/o/r/issues/10", True)
        await sync_task_fields_to_external(task, db, {"due_date"})
        mock_update.assert_not_called()


class TestDueDateInbound:
    def test_gitea_webhook_sets_task_due_date(self, client, sample_project, db):
        headers = {"X-GitHub-Event": "issues"}
        body = {
            "action": "opened",
            "issue": {"number": 55, "title": "Due task", "due_date": "2026-10-05T00:00:00Z"},
            "repository": {"full_name": "o/r"},
        }
        resp = client.post(f"/webhook/issues/{sample_project.id}", json=body, headers=headers)
        assert resp.status_code == 200
        task = find_task_by_external_id(db, "55")
        assert task is not None and task.due_date is not None and task.due_date.month == 10


class TestMilestoneCycle:
    """milestone <-> cycle mapping (ADR-0029)."""

    def _integration(self, db, project_id, url="https://github.com", secret="ghp"):
        db.add(Integration(name="s", type="issue_sync", url=url, project_id=project_id, secret=secret, active=True))
        db.commit()

    def test_normalize_github_milestone_title(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {
            "action": "edited",
            "issue": {"number": 1, "title": "x", "milestone": {"title": "Sprint 12"}},
            "repository": {"full_name": "o/r"},
        }
        assert normalize_github_issue(payload)["milestone"] == "Sprint 12"

    def test_normalize_github_no_milestone(self):
        from app.services.issue_sync import normalize_github_issue

        payload = {"action": "opened", "issue": {"number": 1, "title": "x"}, "repository": {"full_name": "o/r"}}
        assert normalize_github_issue(payload)["milestone"] is None

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.set_github_issue_milestone", new_callable=AsyncMock, return_value=True)
    @patch("app.routers.issue_sync.find_or_create_github_milestone", new_callable=AsyncMock, return_value=7)
    async def test_outbound_add_to_cycle_sets_milestone(self, mock_find, mock_set, client, db, sample_project):
        from datetime import UTC, datetime

        from app.services import graph

        self._integration(db, sample_project.id)
        cycle = graph.create_cycle(db, sample_project.id, name="Sprint 12", end_date=datetime(2026, 8, 1, tzinfo=UTC))
        task = make_task(
            db,
            project_id=sample_project.id,
            title="t",
            external_provider="github",
            external_id="10",
            external_repo="o/r",
            external_url="https://github.com/o/r/issues/10",
        )
        db.add(task)
        db.commit()

        resp = client.post(f"/projects/{sample_project.id}/cycles/{cycle.id}/tasks/{task.id}")
        assert resp.status_code == 201, resp.text
        mock_find.assert_called_once()
        # find_or_create called with the cycle name and its end_date as RFC3339 due_on
        assert mock_find.call_args[0][1] == "Sprint 12"
        assert mock_find.call_args[0][2].startswith("2026-08-01")
        mock_set.assert_called_once_with("o/r", "10", 7, "ghp", "https://api.github.com")

    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.set_github_issue_milestone", new_callable=AsyncMock, return_value=True)
    async def test_outbound_remove_from_cycle_clears_milestone(self, mock_set, client, db, sample_project):
        from app.services import graph

        self._integration(db, sample_project.id)
        cycle = graph.create_cycle(db, sample_project.id, name="Sprint 12")
        task = make_task(
            db,
            project_id=sample_project.id,
            title="t",
            external_provider="github",
            external_id="10",
            external_repo="o/r",
            external_url="https://github.com/o/r/issues/10",
        )
        db.add(task)
        db.flush()
        graph.add_to_cycle(db, cycle.id, task.id)
        db.commit()

        resp = client.delete(f"/projects/{sample_project.id}/cycles/{cycle.id}/tasks/{task.id}")
        assert resp.status_code == 204
        # No cycle left -> milestone cleared with None
        mock_set.assert_called_once_with("o/r", "10", None, "ghp", "https://api.github.com")

    def test_inbound_milestone_maps_to_existing_cycle(self, client, db, sample_project):
        from app.services import graph

        cycle = graph.create_cycle(db, sample_project.id, name="Sprint 9")
        db.commit()
        body = {
            "action": "opened",
            "issue": {"number": 20, "title": "Task", "milestone": {"title": "Sprint 9"}},
            "repository": {"full_name": "o/r"},
        }
        resp = client.post(f"/webhook/issues/{sample_project.id}", json=body, headers={"X-GitHub-Event": "issues"})
        assert resp.status_code == 200
        task = find_task_by_external_id(db, "20")
        assert task is not None
        assert task.id in graph.task_ids_in_cycle(db, cycle.id)

    def test_inbound_milestone_no_matching_cycle_is_ignored(self, client, db, sample_project):
        from app.services import graph

        body = {
            "action": "opened",
            "issue": {"number": 21, "title": "Task", "milestone": {"title": "Nonexistent"}},
            "repository": {"full_name": "o/r"},
        }
        resp = client.post(f"/webhook/issues/{sample_project.id}", json=body, headers={"X-GitHub-Event": "issues"})
        assert resp.status_code == 200
        task = find_task_by_external_id(db, "21")
        # No cycle created, no membership added.
        assert graph.cycle_ids_for_task(db, task.id) == []
