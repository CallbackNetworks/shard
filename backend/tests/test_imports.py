"""Tests for the imports router (Trello, Linear, GitHub Issues)."""

from app.services import graph
from tests.factories import find_task_by_title


class TestTrelloImport:
    def test_import_cards_open_and_closed(self, client, sample_project):
        payload = {
            "cards": [
                {
                    "name": "Open card",
                    "desc": "Description A",
                    "closed": False,
                    "labels": [{"name": "bug"}],
                    "due": "2026-08-01T00:00:00Z",
                },
                {
                    "name": "Closed card",
                    "desc": "Description B",
                    "closed": True,
                    "labels": [{"name": "feature"}],
                    "due": None,
                },
            ]
        }
        resp = client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 2
        assert data["skipped"] == 0
        assert data["errors"] == []

    def test_trello_creates_labels(self, client, sample_project, db):
        payload = {
            "cards": [
                {"name": "Card with label", "desc": "", "closed": False, "labels": [{"name": "urgent"}]},
            ]
        }
        client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)

        label = graph.find_label_by_name(db, sample_project.id, "urgent")
        assert label is not None
        assert label.color == "#6366f1"

    def test_trello_closed_card_status_done(self, client, sample_project, db):
        payload = {"cards": [{"name": "Done card", "closed": True, "labels": []}]}
        client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)

        task = find_task_by_title(db, "Done card")
        assert task is not None
        assert task.status == "done"

    def test_trello_open_card_status_todo(self, client, sample_project, db):
        payload = {"cards": [{"name": "Todo card", "closed": False, "labels": []}]}
        client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)

        task = find_task_by_title(db, "Todo card")
        assert task is not None
        assert task.status == "todo"

    def test_trello_due_date_parsed(self, client, sample_project, db):
        payload = {"cards": [{"name": "Due card", "closed": False, "due": "2026-09-15T10:00:00Z", "labels": []}]}
        client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)

        task = find_task_by_title(db, "Due card")
        assert task is not None
        assert task.due_date is not None


class TestLinearImport:
    def test_import_issues_with_states(self, client, sample_project, db):
        payload = {
            "issues": [
                {"title": "Linear done", "state": "Done", "priority": 1, "labels": ["backend"]},
                {"title": "Linear completed", "state": "Completed", "priority": 2, "labels": []},
                {"title": "Linear in progress", "state": "In Progress", "priority": 3, "labels": []},
                {"title": "Linear backlog", "state": "Backlog", "priority": 4, "labels": []},
            ]
        }
        resp = client.post(f"/api/projects/{sample_project.id}/import/linear", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 4
        assert data["skipped"] == 0

        done_task = find_task_by_title(db, "Linear done")
        assert done_task.status == "done"
        assert done_task.priority == "high"

        completed_task = find_task_by_title(db, "Linear completed")
        assert completed_task.status == "done"
        assert completed_task.priority == "high"

        ip_task = find_task_by_title(db, "Linear in progress")
        assert ip_task.status == "in_progress"
        assert ip_task.priority == "medium"

        backlog_task = find_task_by_title(db, "Linear backlog")
        assert backlog_task.status == "todo"
        assert backlog_task.priority == "low"

    def test_linear_assignee(self, client, sample_project, db):
        payload = {
            "issues": [
                {"title": "Assigned issue", "state": "Todo", "assignee": "alice", "labels": []},
            ]
        }
        client.post(f"/api/projects/{sample_project.id}/import/linear", json=payload)

        task = find_task_by_title(db, "Assigned issue")
        assert task.assignee == "alice"

    def test_linear_labels_created(self, client, sample_project, db):
        payload = {
            "issues": [
                {"title": "Labeled issue", "labels": ["enhancement", "p1"]},
            ]
        }
        client.post(f"/api/projects/{sample_project.id}/import/linear", json=payload)

        labels = graph.labels_in_project(db, sample_project.id)
        label_names = {lb.name for lb in labels}
        assert "enhancement" in label_names
        assert "p1" in label_names


class TestGitHubImport:
    def test_import_issues_with_external_fields(self, client, sample_project, db):
        payload = {
            "issues": [
                {
                    "number": 42,
                    "title": "Fix bug",
                    "body": "Something is broken",
                    "state": "open",
                    "html_url": "https://github.com/org/repo/issues/42",
                    "labels": [{"name": "bug"}],
                    "assignee": {"login": "octocat"},
                },
                {
                    "number": 99,
                    "title": "Closed issue",
                    "body": "Was fixed",
                    "state": "closed",
                    "html_url": "https://github.com/org/repo/issues/99",
                    "labels": [],
                    "assignee": None,
                },
            ]
        }
        resp = client.post(f"/api/projects/{sample_project.id}/import/github", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 2
        assert data["skipped"] == 0

        open_task = find_task_by_title(db, "Fix bug")
        assert open_task.status == "todo"
        assert open_task.external_provider == "github"
        assert open_task.external_id == "42"
        assert open_task.external_url == "https://github.com/org/repo/issues/42"
        assert open_task.assignee == "octocat"

        closed_task = find_task_by_title(db, "Closed issue")
        assert closed_task.status == "done"
        assert closed_task.external_provider == "github"
        assert closed_task.external_id == "99"

    def test_github_labels_created(self, client, sample_project, db):
        payload = {
            "issues": [
                {
                    "number": 1,
                    "title": "With labels",
                    "state": "open",
                    "labels": [{"name": "enhancement"}, {"name": "help wanted"}],
                },
            ]
        }
        client.post(f"/api/projects/{sample_project.id}/import/github", json=payload)

        labels = graph.labels_in_project(db, sample_project.id)
        label_names = {lb.name for lb in labels}
        assert "enhancement" in label_names
        assert "help wanted" in label_names


class TestImportEdgeCases:
    def test_import_nonexistent_project_404(self, client):
        payload = {"cards": [{"name": "X", "closed": False, "labels": []}]}
        resp = client.post("/api/projects/nonexistent-id/import/trello", json=payload)
        assert resp.status_code == 404

    def test_empty_trello_import(self, client, sample_project):
        payload = {"cards": []}
        resp = client.post(f"/api/projects/{sample_project.id}/import/trello", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 0
        assert data["skipped"] == 0

    def test_empty_linear_import(self, client, sample_project):
        payload = {"issues": []}
        resp = client.post(f"/api/projects/{sample_project.id}/import/linear", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 0

    def test_empty_github_import(self, client, sample_project):
        payload = {"issues": []}
        resp = client.post(f"/api/projects/{sample_project.id}/import/github", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["imported"] == 0

    def test_linear_nonexistent_project(self, client):
        payload = {"issues": [{"title": "X", "labels": []}]}
        resp = client.post("/api/projects/no-such-id/import/linear", json=payload)
        assert resp.status_code == 404

    def test_github_nonexistent_project(self, client):
        payload = {"issues": [{"title": "X", "state": "open", "labels": []}]}
        resp = client.post("/api/projects/no-such-id/import/github", json=payload)
        assert resp.status_code == 404
