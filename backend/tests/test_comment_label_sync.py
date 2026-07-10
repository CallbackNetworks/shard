"""Tests for bidirectional issue-comment and label sync (GitHub/Gitea/GitLab)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models import Comment, Integration, Label, Task, TaskLabel


def _make_external_task(db, project_id, **overrides):
    defaults = dict(
        project_id=project_id,
        title="External task",
        external_provider="github",
        external_id="42",
        external_repo="owner/repo",
        external_url="https://github.com/owner/repo/issues/42",
    )
    defaults.update(overrides)
    task = Task(**defaults)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def _make_integration(db, project_id, **overrides):
    defaults = dict(
        name="github-sync",
        type="issue_sync",
        url="https://github.com",
        project_id=project_id,
        secret="ghp_testtoken",
        active=True,
    )
    defaults.update(overrides)
    integration = Integration(**defaults)
    db.add(integration)
    db.commit()
    return integration


def _github_comment_payload(action="created", comment_id=1001, body="A comment", issue_number=42):
    return {
        "action": action,
        "comment": {
            "id": comment_id,
            "body": body,
            "html_url": f"https://github.com/owner/repo/issues/{issue_number}#issuecomment-{comment_id}",
            "user": {"login": "devuser"},
        },
        "issue": {"number": issue_number},
        "repository": {"full_name": "owner/repo"},
    }


class TestCommentNormalization:
    def test_normalize_github_comment(self):
        from app.services.issue_sync import normalize_github_comment

        result = normalize_github_comment(_github_comment_payload())
        assert result is not None
        assert result["provider"] == "github"
        assert result["action"] == "created"
        assert result["comment_id"] == "1001"
        assert result["body"] == "A comment"
        assert result["author"] == "devuser"
        assert result["issue_id"] == "42"
        assert result["repo"] == "owner/repo"

    def test_normalize_github_comment_missing(self):
        from app.services.issue_sync import normalize_github_comment

        assert normalize_github_comment({"action": "created"}) is None

    def test_normalize_gitlab_note(self):
        from app.services.issue_sync import normalize_gitlab_note

        payload = {
            "object_attributes": {
                "id": 501,
                "note": "GL note",
                "noteable_type": "Issue",
                "action": "create",
                "url": "https://gitlab.com/group/proj/-/issues/7#note_501",
            },
            "user": {"username": "gluser"},
            "issue": {"iid": 7},
            "project": {"path_with_namespace": "group/proj"},
        }
        result = normalize_gitlab_note(payload)
        assert result is not None
        assert result["provider"] == "gitlab"
        assert result["action"] == "created"
        assert result["comment_id"] == "501"
        assert result["issue_id"] == "7"
        assert result["author"] == "gluser"

    def test_normalize_gitlab_note_non_issue(self):
        from app.services.issue_sync import normalize_gitlab_note

        payload = {"object_attributes": {"id": 1, "note": "x", "noteable_type": "MergeRequest"}}
        assert normalize_gitlab_note(payload) is None

    def test_detect_comment_webhook(self):
        from app.services.issue_sync import detect_comment_webhook

        assert detect_comment_webhook({"x-github-event": "issue_comment"}, _github_comment_payload()) is not None
        assert detect_comment_webhook({"x-github-event": "issues"}, {}) is None
        assert detect_comment_webhook({}, {}) is None


class TestInboundCommentWebhook:
    def test_creates_comment_on_linked_task(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_comment_payload(),
            headers={"x-github-event": "issue_comment"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "comment_created"

        comment = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert comment is not None
        assert comment.body == "A comment"
        assert comment.author == "devuser"
        assert comment.external_id == "1001"

    def test_echo_of_outbound_comment_ignored(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)
        db.add(Comment(task_id=task.id, project_id=sample_project.id, body="pushed from Shard", external_id="1001"))
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_comment_payload(body="pushed from Shard"),
            headers={"x-github-event": "issue_comment"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "comment_echo_ignored"
        assert db.query(Comment).filter(Comment.task_id == task.id).count() == 1

    def test_edited_updates_body(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)
        db.add(Comment(task_id=task.id, project_id=sample_project.id, body="old", external_id="1001"))
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_comment_payload(action="edited", body="new body"),
            headers={"x-github-event": "issue_comment"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "comment_updated"
        comment = db.query(Comment).filter(Comment.task_id == task.id).first()
        assert comment.body == "new body"

    def test_deleted_removes_comment(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)
        db.add(Comment(task_id=task.id, project_id=sample_project.id, body="bye", external_id="1001"))
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_comment_payload(action="deleted"),
            headers={"x-github-event": "issue_comment"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "comment_deleted"
        assert db.query(Comment).filter(Comment.task_id == task.id).count() == 0

    def test_no_linked_task_ignored(self, client, sample_project, db):
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_comment_payload(),
            headers={"x-github-event": "issue_comment"},
        )
        assert r.status_code == 200
        assert "no linked task" in r.json()["detail"].lower()
        assert db.query(Comment).count() == 0


def _github_issue_payload(labels, action="labeled", issue_number=42):
    return {
        "action": action,
        "issue": {
            "number": issue_number,
            "html_url": f"https://github.com/owner/repo/issues/{issue_number}",
            "title": "External task",
            "body": "desc",
            "state": "open",
            "labels": [{"name": name} for name in labels],
            "assignee": None,
        },
        "repository": {"full_name": "owner/repo"},
    }


class TestInboundLabelMirror:
    def test_labels_created_and_attached(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_issue_payload(["bug", "urgent"]),
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        db.expire_all()
        names = sorted(tl.label.name for tl in task.task_labels)
        assert names == ["bug", "urgent"]
        bug = db.query(Label).filter(Label.project_id == sample_project.id, Label.name == "bug").first()
        assert bug.source == "issue_sync"

    def test_removed_external_labels_detached(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)
        for name in ("bug", "urgent"):
            label = Label(project_id=sample_project.id, name=name)
            db.add(label)
            db.flush()
            db.add(TaskLabel(task_id=task.id, label_id=label.id))
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_issue_payload(["bug"]),
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        db.expire_all()
        names = [tl.label.name for tl in task.task_labels]
        assert names == ["bug"]

    def test_decision_labels_untouched(self, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)
        decision = Label(project_id=sample_project.id, name="use-postgres", type="decision")
        db.add(decision)
        db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=decision.id))
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_issue_payload(["bug"]),
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        db.expire_all()
        names = sorted(tl.label.name for tl in task.task_labels)
        assert names == ["bug", "use-postgres"]

    def test_new_task_gets_labels(self, client, sample_project, db):
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=_github_issue_payload(["feature"], action="opened", issue_number=77),
            headers={"x-github-event": "issues"},
        )
        assert r.status_code == 200
        task = db.query(Task).filter(Task.external_id == "77").first()
        assert task is not None
        assert [tl.label.name for tl in task.task_labels] == ["feature"]


class TestOutboundReopen:
    @pytest.mark.asyncio
    @patch("app.routers.issue_sync.reopen_github_issue", new_callable=AsyncMock, return_value=True)
    async def test_reopen_github(self, mock_reopen, client, sample_project, db):
        from app.routers.issue_sync import sync_task_reopen_to_external

        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id, status="todo")

        result = await sync_task_reopen_to_external(task, db)
        assert result is True
        mock_reopen.assert_called_once_with("owner/repo", "42", "ghp_testtoken", "https://api.github.com")

    @patch("app.routers.issue_sync.reopen_github_issue", new_callable=AsyncMock, return_value=True)
    def test_reopen_triggered_by_status_change(self, mock_reopen, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id, status="done")

        r = client.patch(f"/projects/{sample_project.id}/tasks/{task.id}", json={"status": "todo"})
        assert r.status_code == 200
        mock_reopen.assert_called_once()

    @patch("app.routers.issue_sync.reopen_github_issue", new_callable=AsyncMock, return_value=True)
    def test_no_reopen_between_open_statuses(self, mock_reopen, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id, status="todo")

        r = client.patch(f"/projects/{sample_project.id}/tasks/{task.id}", json={"status": "in_progress"})
        assert r.status_code == 200
        mock_reopen.assert_not_called()


class TestOutboundComments:
    @patch("app.routers.issue_sync.create_github_issue_comment", new_callable=AsyncMock, return_value="9001")
    def test_comment_create_pushed(self, mock_create, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id)

        r = client.post(
            f"/projects/{sample_project.id}/tasks/{task.id}/comments",
            json={"body": "hello from Shard", "author": "me"},
        )
        assert r.status_code == 201
        mock_create.assert_called_once_with(
            "owner/repo", "42", "hello from Shard", "ghp_testtoken", "https://api.github.com"
        )
        assert r.json()["external_id"] == "9001"

    @patch("app.routers.issue_sync.create_github_issue_comment", new_callable=AsyncMock, return_value="9001")
    def test_comment_not_pushed_without_integration(self, mock_create, client, sample_project, db):
        task = _make_external_task(db, sample_project.id)

        r = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/comments", json={"body": "local only"})
        assert r.status_code == 201
        mock_create.assert_not_called()
        assert r.json()["external_id"] is None

    @patch("app.routers.issue_sync.update_github_issue_comment", new_callable=AsyncMock, return_value=True)
    def test_comment_edit_pushed(self, mock_update, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id)
        comment = Comment(task_id=task.id, project_id=sample_project.id, body="old", external_id="9001")
        db.add(comment)
        db.commit()
        db.refresh(comment)

        r = client.patch(
            f"/projects/{sample_project.id}/tasks/{task.id}/comments/{comment.id}",
            json={"body": "edited"},
        )
        assert r.status_code == 200
        mock_update.assert_called_once_with("owner/repo", "9001", "edited", "ghp_testtoken", "https://api.github.com")

    @patch("app.routers.issue_sync.delete_github_issue_comment", new_callable=AsyncMock, return_value=True)
    def test_comment_delete_pushed(self, mock_delete, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id)
        comment = Comment(task_id=task.id, project_id=sample_project.id, body="bye", external_id="9001")
        db.add(comment)
        db.commit()
        db.refresh(comment)

        r = client.delete(f"/projects/{sample_project.id}/tasks/{task.id}/comments/{comment.id}")
        assert r.status_code == 204
        mock_delete.assert_called_once_with("owner/repo", "9001", "ghp_testtoken", "https://api.github.com")


class TestOutboundLabels:
    @patch("app.routers.issue_sync.replace_github_issue_labels", new_callable=AsyncMock, return_value=True)
    def test_label_add_pushed(self, mock_replace, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id)
        label = Label(project_id=sample_project.id, name="bug")
        db.add(label)
        db.commit()

        r = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/labels/{label.id}")
        assert r.status_code == 201
        mock_replace.assert_called_once_with("owner/repo", "42", ["bug"], "ghp_testtoken", "https://api.github.com")

    @patch("app.routers.issue_sync.replace_github_issue_labels", new_callable=AsyncMock, return_value=True)
    def test_label_remove_pushed(self, mock_replace, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = _make_external_task(db, sample_project.id)
        label = Label(project_id=sample_project.id, name="bug")
        db.add(label)
        db.flush()
        db.add(TaskLabel(task_id=task.id, label_id=label.id))
        db.commit()

        r = client.delete(f"/projects/{sample_project.id}/tasks/{task.id}/labels/{label.id}")
        assert r.status_code == 204
        mock_replace.assert_called_once_with("owner/repo", "42", [], "ghp_testtoken", "https://api.github.com")

    @patch("app.routers.issue_sync.replace_github_issue_labels", new_callable=AsyncMock, return_value=True)
    def test_local_task_labels_not_pushed(self, mock_replace, client, sample_project, db):
        _make_integration(db, sample_project.id)
        task = Task(project_id=sample_project.id, title="Local task")
        db.add(task)
        label = Label(project_id=sample_project.id, name="bug")
        db.add(label)
        db.commit()

        r = client.post(f"/projects/{sample_project.id}/tasks/{task.id}/labels/{label.id}")
        assert r.status_code == 201
        mock_replace.assert_not_called()
