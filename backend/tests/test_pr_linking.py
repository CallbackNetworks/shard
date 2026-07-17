"""Tests for GitHub PR linking (normalization, detection, webhook handling)."""

from app.models import Notification, TaskPullRequest
from app.services.issue_sync import (
    detect_pr_review_webhook,
    detect_pr_webhook,
    normalize_github_pr,
    normalize_github_pr_review,
    parse_issue_refs,
)
from tests.factories import make_task


class TestParseIssueRefs:
    """Unit tests for parsing issue references from PR body text."""

    def test_fixes_single(self):
        assert parse_issue_refs("Fixes #42") == ["42"]

    def test_closes_single(self):
        assert parse_issue_refs("Closes #10") == ["10"]

    def test_resolves_single(self):
        assert parse_issue_refs("Resolves #7") == ["7"]

    def test_multiple_refs(self):
        text = "Fixes #1, Closes #2, Resolves #3"
        result = parse_issue_refs(text)
        assert sorted(result) == ["1", "2", "3"]

    def test_case_insensitive(self):
        assert parse_issue_refs("FIXES #5") == ["5"]
        assert parse_issue_refs("closes #8") == ["8"]
        assert parse_issue_refs("RESOLVES #9") == ["9"]

    def test_past_tense(self):
        assert parse_issue_refs("Fixed #11") == ["11"]
        assert parse_issue_refs("Closed #12") == ["12"]
        assert parse_issue_refs("Resolved #13") == ["13"]

    def test_no_refs(self):
        assert parse_issue_refs("No issue references here") == []
        assert parse_issue_refs("") == []
        assert parse_issue_refs(None) == []

    def test_embedded_in_text(self):
        text = "This PR fixes #42 and also resolves #99 by refactoring the handler."
        result = parse_issue_refs(text)
        assert sorted(result) == ["42", "99"]


class TestNormalizeGithubPr:
    """Unit tests for normalizing GitHub PR webhook payloads."""

    def _make_pr_payload(self, action="opened", merged=False, body="", number=123):
        return {
            "action": action,
            "pull_request": {
                "number": number,
                "html_url": f"https://github.com/owner/repo/pull/{number}",
                "title": f"PR #{number}: Test change",
                "body": body,
                "merged": merged,
                "head": {"ref": "feature-branch"},
            },
            "repository": {"full_name": "owner/repo"},
        }

    def test_opened(self):
        payload = self._make_pr_payload(action="opened", body="Fixes #42")
        result = normalize_github_pr(payload)
        assert result is not None
        assert result["type"] == "pull_request"
        assert result["action"] == "opened"
        assert result["pr_number"] == 123
        assert result["pr_url"] == "https://github.com/owner/repo/pull/123"
        assert result["pr_title"] == "PR #123: Test change"
        assert result["branch"] == "feature-branch"
        assert result["merged"] is False
        assert result["repo"] == "owner/repo"
        assert result["issue_refs"] == ["42"]

    def test_merged(self):
        payload = self._make_pr_payload(action="closed", merged=True, body="Closes #10")
        result = normalize_github_pr(payload)
        assert result["action"] == "closed"
        assert result["merged"] is True
        assert result["issue_refs"] == ["10"]

    def test_closed_not_merged(self):
        payload = self._make_pr_payload(action="closed", merged=False)
        result = normalize_github_pr(payload)
        assert result["action"] == "closed"
        assert result["merged"] is False

    def test_no_pull_request_key(self):
        assert normalize_github_pr({"action": "opened"}) is None

    def test_no_body(self):
        payload = self._make_pr_payload(body=None)
        # Body is None in the PR object
        payload["pull_request"]["body"] = None
        result = normalize_github_pr(payload)
        assert result["body"] == ""
        assert result["issue_refs"] == []

    def test_no_head(self):
        payload = self._make_pr_payload()
        payload["pull_request"]["head"] = None
        result = normalize_github_pr(payload)
        assert result["branch"] == ""


class TestDetectPrWebhook:
    """Unit tests for PR webhook detection."""

    def test_detect_pull_request_event(self):
        headers = {"x-github-event": "pull_request"}
        payload = {
            "action": "opened",
            "pull_request": {
                "number": 5,
                "html_url": "https://github.com/o/r/pull/5",
                "title": "test",
                "body": "",
                "merged": False,
                "head": {"ref": "main"},
            },
            "repository": {"full_name": "o/r"},
        }
        result = detect_pr_webhook(headers, payload)
        assert result is not None
        assert result["type"] == "pull_request"
        assert result["pr_number"] == 5

    def test_non_pr_event(self):
        assert detect_pr_webhook({"x-github-event": "issues"}, {}) is None

    def test_empty_headers(self):
        assert detect_pr_webhook({}, {}) is None

    def test_push_event(self):
        assert detect_pr_webhook({"x-github-event": "push"}, {}) is None


class TestPrWebhookEndpoint:
    """Integration tests for the PR webhook endpoint."""

    def _pr_payload(self, action="opened", merged=False, body="", number=50):
        return {
            "action": action,
            "pull_request": {
                "number": number,
                "html_url": f"https://github.com/test/repo/pull/{number}",
                "title": f"PR #{number}",
                "body": body,
                "merged": merged,
                "head": {"ref": "feature"},
            },
            "repository": {"full_name": "test/repo"},
        }

    def test_pr_merge_closes_linked_tasks(self, client, sample_project, db):
        """When a merged PR references 'Fixes #N', matching tasks become done."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Linked issue",
            status="in_progress",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        payload = self._pr_payload(action="closed", merged=True, body="Fixes #42")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["action"] == "pr_merged"
        assert task.id in data["affected_tasks"]

        db.refresh(task)
        assert task.status == "done"

    def test_pr_merge_multiple_refs(self, client, sample_project, db):
        """A merged PR can close multiple tasks at once."""
        task1 = make_task(
            db,
            project_id=sample_project.id,
            title="Issue one",
            status="todo",
            external_provider="github",
            external_id="10",
            external_repo="test/repo",
        )
        task2 = make_task(
            db,
            project_id=sample_project.id,
            title="Issue two",
            status="in_progress",
            external_provider="github",
            external_id="20",
            external_repo="test/repo",
        )
        db.add_all([task1, task2])
        db.commit()

        payload = self._pr_payload(action="closed", merged=True, body="Fixes #10, Closes #20")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "pr_merged"
        assert len(data["affected_tasks"]) == 2

        db.refresh(task1)
        db.refresh(task2)
        assert task1.status == "done"
        assert task2.status == "done"

    def test_pr_opened_links_to_task(self, client, sample_project, db):
        """When a PR is opened with 'Fixes #N', a structured PR link is created and the task starts."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Link target",
            description="Original description",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        payload = self._pr_payload(action="opened", body="Fixes #42", number=77)
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "pr_linked"
        assert task.id in data["affected_tasks"]

        db.refresh(task)
        # Description is no longer mutated — the link is a structured row
        assert task.description == "Original description"
        assert task.status == "in_progress"
        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link is not None
        assert link.pr_number == "77"
        assert link.pr_url == "https://github.com/test/repo/pull/77"
        assert link.state == "open"
        assert link.branch == "feature"

    def test_pr_edited_upserts_link_once(self, client, sample_project, db):
        """Repeated PR events upsert the same structured link instead of duplicating."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Already linked",
            status="in_progress",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        for _ in range(2):
            payload = self._pr_payload(action="edited", body="Fixes #42", number=77)
            r = client.post(
                f"/webhook/issues/{sample_project.id}",
                json=payload,
                headers={"x-github-event": "pull_request"},
            )
            assert r.status_code == 200
            assert r.json()["action"] == "pr_linked"

        links = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).all()
        assert len(links) == 1
        db.refresh(task)
        # edited does not touch status
        assert task.status == "in_progress"

    def test_pr_without_issue_refs_no_effect(self, client, sample_project, db):
        """A PR without issue references is acknowledged but does not affect tasks."""
        payload = self._pr_payload(action="opened", body="Just a regular PR")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["affected_tasks"] == []

    def test_pr_closed_not_merged(self, client, sample_project, db):
        """A closed-but-not-merged PR keeps the task open, flags the link, and raises a notification."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Should stay open",
            status="in_progress",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()

        payload = self._pr_payload(action="closed", merged=False, body="Fixes #42")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "pr_closed"

        db.refresh(task)
        assert task.status == "in_progress"
        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.state == "closed"
        notif = db.query(Notification).filter(Notification.type == "pr.closed").first()
        assert notif is not None
        assert notif.task_id == task.id
        assert notif.link == "https://github.com/test/repo/pull/50"

    def test_pr_merge_closes_task_by_description_url(self, client, sample_project, db):
        """A merged PR also closes tasks whose description contains the PR URL."""
        pr_url = "https://github.com/test/repo/pull/50"
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Linked via description",
            description=f"See PR: {pr_url}",
            status="in_progress",
            external_provider="github",
            external_id="999",  # different ID, not in refs
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        payload = self._pr_payload(action="closed", merged=True, body="No issue refs here", number=50)
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "pr_merged"
        assert task.id in data["affected_tasks"]

        db.refresh(task)
        assert task.status == "done"

    def test_non_pr_event_ignored(self, client, sample_project):
        """Push events are ignored."""
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json={"ref": "refs/heads/main"},
            headers={"x-github-event": "push"},
        )
        assert r.status_code == 200
        assert r.json()["detail"] == "Ignored (not an issue event)"

    def test_pr_merge_already_done_task_not_duplicated(self, client, sample_project, db):
        """Tasks already marked done are not re-processed."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Already done",
            status="done",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()

        payload = self._pr_payload(action="closed", merged=True, body="Fixes #42")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["action"] == "pr_merged"
        # The task stays done; only its PR link is updated to merged
        db.refresh(task)
        assert task.status == "done"
        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.state == "merged"

    def test_pr_wrong_repo_no_match(self, client, sample_project, db):
        """Tasks from a different repo are not affected."""
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Different repo",
            status="todo",
            external_provider="github",
            external_id="42",
            external_repo="other/repo",
        )
        db.add(task)
        db.commit()

        payload = self._pr_payload(action="closed", merged=True, body="Fixes #42")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["affected_tasks"] == []

    def test_review_requested_flags_link_and_notifies(self, client, sample_project, db):
        task = make_task(
            db,
            project_id=sample_project.id,
            title="Awaiting review",
            status="in_progress",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        db.add(task)
        db.commit()

        payload = self._pr_payload(action="review_requested", body="Fixes #42")
        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "pr_review_requested"

        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.review_state == "review_requested"
        notif = db.query(Notification).filter(Notification.type == "pr.review_requested").first()
        assert notif is not None
        assert notif.link == "https://github.com/test/repo/pull/50"

    def test_project_not_found(self, client):
        """PR webhook to a nonexistent project returns 404."""
        payload = {
            "action": "opened",
            "pull_request": {
                "number": 1,
                "html_url": "https://github.com/o/r/pull/1",
                "title": "t",
                "body": "",
                "merged": False,
                "head": {"ref": "main"},
            },
            "repository": {"full_name": "o/r"},
        }
        r = client.post(
            "/webhook/issues/nonexistent",
            json=payload,
            headers={"x-github-event": "pull_request"},
        )
        assert r.status_code == 404


class TestPrReviewSignals:
    """Tests for pull_request_review webhook handling (signals only, content stays external)."""

    def _review_payload(self, state="approved", action="submitted", body="Fixes #42", number=50):
        return {
            "action": action,
            "review": {
                "state": state,
                "user": {"login": "reviewer1"},
            },
            "pull_request": {
                "number": number,
                "html_url": f"https://github.com/test/repo/pull/{number}",
                "title": f"PR #{number}",
                "body": body,
            },
            "repository": {"full_name": "test/repo"},
        }

    def test_normalize_github_pr_review(self):
        result = normalize_github_pr_review(self._review_payload(state="APPROVED"))
        assert result is not None
        assert result["type"] == "pull_request_review"
        assert result["action"] == "submitted"
        assert result["review_state"] == "approved"
        assert result["reviewer"] == "reviewer1"
        assert result["pr_number"] == 50
        assert result["issue_refs"] == ["42"]

    def test_normalize_missing_review(self):
        assert normalize_github_pr_review({"action": "submitted"}) is None

    def test_detect_pr_review_webhook(self):
        headers = {"x-github-event": "pull_request_review"}
        assert detect_pr_review_webhook(headers, self._review_payload()) is not None
        assert detect_pr_review_webhook({"x-github-event": "pull_request"}, {}) is None

    def _make_task(self, db, project_id, **overrides):
        defaults = dict(
            project_id=project_id,
            title="Reviewed task",
            status="in_progress",
            external_provider="github",
            external_id="42",
            external_repo="test/repo",
        )
        defaults.update(overrides)
        task = make_task(db, **defaults)
        db.add(task)
        db.commit()
        db.refresh(task)
        return task

    def test_approved_review_updates_link_and_notifies(self, client, sample_project, db):
        task = self._make_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=self._review_payload(state="approved"),
            headers={"x-github-event": "pull_request_review"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "pr_review_approved"

        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.review_state == "approved"
        notif = db.query(Notification).filter(Notification.type == "pr.approved").first()
        assert notif is not None
        assert notif.task_id == task.id

    def test_changes_requested_notifies(self, client, sample_project, db):
        task = self._make_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=self._review_payload(state="changes_requested"),
            headers={"x-github-event": "pull_request_review"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "pr_review_changes_requested"

        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.review_state == "changes_requested"
        assert db.query(Notification).filter(Notification.type == "pr.changes_requested").count() == 1

    def test_commented_review_no_notification(self, client, sample_project, db):
        task = self._make_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=self._review_payload(state="commented"),
            headers={"x-github-event": "pull_request_review"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "pr_review_commented"

        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.review_state == "commented"
        assert db.query(Notification).count() == 0

    def test_review_matches_task_via_existing_link(self, client, sample_project, db):
        """A review on a PR without issue refs still matches tasks through the stored PR link."""
        task = self._make_task(db, sample_project.id, external_id="999")
        db.add(
            TaskPullRequest(
                task_id=task.id,
                repo="test/repo",
                pr_number="50",
                pr_url="https://github.com/test/repo/pull/50",
                pr_title="PR #50",
            )
        )
        db.commit()

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=self._review_payload(state="approved", body="no refs"),
            headers={"x-github-event": "pull_request_review"},
        )
        assert r.status_code == 200
        assert task.id in r.json()["affected_tasks"]

        link = db.query(TaskPullRequest).filter(TaskPullRequest.task_id == task.id).first()
        assert link.review_state == "approved"

    def test_dismissed_review_ignored(self, client, sample_project, db):
        self._make_task(db, sample_project.id)

        r = client.post(
            f"/webhook/issues/{sample_project.id}",
            json=self._review_payload(state="approved", action="dismissed"),
            headers={"x-github-event": "pull_request_review"},
        )
        assert r.status_code == 200
        assert r.json()["action"] == "pr_review_ignored"
