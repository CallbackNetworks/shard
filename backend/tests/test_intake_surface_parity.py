"""Work gets in, out and filed through either door (ADR-0092).

The importers, publishing a task as a real issue, the unfiled bucket, decision records and
cycle rollover were internal-only — which in production is browser-only (ADR-0085). The
importers were the sharpest case: turning a pile of issues into tasks is the most obviously
agent-shaped act in the product, and it was the one act only a person with a file picker
could start.

Same discipline as ``test_ops_surface_parity``: the same request through both doors against
one database, comparing status *and* detail, because two doors returning 200 is exactly what
a drifted duplicate does too (ADR-0087).
"""

import hashlib

import pytest

from app.services import graph
from tests.factories import make_task


def _key(db, name, scopes):
    from app.models import ApiKey

    raw = f"tdp_test_{name}"
    db.add(
        ApiKey(
            name=name,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=scopes,
            active=True,
        )
    )
    db.commit()
    return raw


@pytest.fixture()
def write_key(db):
    return _key(db, "intake_write", ["read", "write"])


@pytest.fixture()
def read_key(db):
    return _key(db, "intake_read", ["read"])


def _hdr(key):
    return {"X-API-Key": key}


class TestImporters:
    def test_github_issues_arrive_as_tasks_through_v1(self, client, db, sample_project, write_key):
        payload = {
            "issues": [
                {
                    "number": 7,
                    "title": "Fix the parser",
                    "body": "It drops the last row",
                    "state": "open",
                    "html_url": "https://github.com/o/r/issues/7",
                    "labels": [{"name": "bug"}],
                    "assignee": {"login": "alice"},
                }
            ]
        }
        resp = client.post(f"/api/v1/projects/{sample_project.id}/import/github", json=payload, headers=_hdr(write_key))
        assert resp.status_code == 200
        assert resp.json() == {"imported": 1, "skipped": 0, "errors": []}

        tasks = client.get(f"/api/v1/projects/{sample_project.id}/tasks", headers=_hdr(write_key)).json()
        imported = next(t for t in tasks if t["title"] == "Fix the parser")
        assert imported["assignee"] == "alice"
        # The external link survives the import, which is what lets two-way sync adopt it.
        assert imported["external_url"] == "https://github.com/o/r/issues/7"

    def test_a_label_is_created_once_and_reused(self, client, db, sample_project, write_key):
        payload = {"issues": [{"title": "One", "labels": [{"name": "bug"}]}]}
        client.post(f"/api/v1/projects/{sample_project.id}/import/github", json=payload, headers=_hdr(write_key))
        payload = {"issues": [{"title": "Two", "labels": [{"name": "bug"}]}]}
        client.post(f"/api/v1/projects/{sample_project.id}/import/github", json=payload, headers=_hdr(write_key))

        labels = client.get(f"/api/v1/projects/{sample_project.id}/labels", headers=_hdr(write_key)).json()
        assert [lb["name"] for lb in labels].count("bug") == 1

    def test_one_bad_row_does_not_abandon_the_batch(self, client, db, sample_project, write_key):
        payload = {"issues": [{"title": "Good"}, {"title": "   "}, {"title": "Also good"}]}
        resp = client.post(f"/api/v1/projects/{sample_project.id}/import/linear", json=payload, headers=_hdr(write_key))
        assert resp.json()["imported"] == 2
        assert resp.json()["skipped"] == 1

    def test_trello_closed_cards_land_done(self, client, db, sample_project, write_key):
        payload = {"cards": [{"name": "Shipped", "closed": True}, {"name": "Open one"}]}
        resp = client.post(f"/api/v1/projects/{sample_project.id}/import/trello", json=payload, headers=_hdr(write_key))
        assert resp.json()["imported"] == 2
        tasks = client.get(f"/api/v1/projects/{sample_project.id}/tasks", headers=_hdr(write_key)).json()
        by_title = {t["title"]: t["status"] for t in tasks}
        assert by_title["Shipped"] == "done"
        assert by_title["Open one"] == "todo"

    def test_a_missing_project_is_refused_identically(self, client, db, write_key):
        body = {"issues": []}
        internal = client.post("/api/projects/nope/import/github", json=body)
        external = client.post("/api/v1/projects/nope/import/github", json=body, headers=_hdr(write_key))
        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]

    def test_importing_needs_write_scope(self, client, db, sample_project, read_key):
        resp = client.post(
            f"/api/v1/projects/{sample_project.id}/import/github", json={"issues": []}, headers=_hdr(read_key)
        )
        assert resp.status_code == 403


class TestPublishingOutward:
    def test_without_an_integration_both_doors_say_the_same_thing(self, client, db, sample_project, write_key):
        task = make_task(db, project_id=sample_project.id, title="Publish me")
        internal = client.post(f"/api/projects/{sample_project.id}/tasks/{task.id}/create-external-issue")
        external = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/create-external-issue", headers=_hdr(write_key)
        )
        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]
        # The refusal has to name what is missing, or the agent cannot act on it (ADR-0078).
        assert "issue_sync" in internal.json()["detail"]

    def test_an_unknown_provider_is_refused_identically(self, client, db, sample_project, write_key):
        task = make_task(db, project_id=sample_project.id, title="Publish me")
        body = {"provider": "bitbucket"}
        internal = client.post(f"/api/projects/{sample_project.id}/tasks/{task.id}/create-external-issue", json=body)
        external = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/{task.id}/create-external-issue",
            json=body,
            headers=_hdr(write_key),
        )
        assert internal.status_code == external.status_code == 400
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_missing_task_is_a_404(self, client, db, sample_project, write_key):
        resp = client.post(
            f"/api/v1/projects/{sample_project.id}/tasks/nope/create-external-issue", headers=_hdr(write_key)
        )
        assert resp.status_code == 404


class TestUnfiledBucket:
    def test_both_doors_see_the_same_bucket(self, client, db, sample_project, write_key):
        task = make_task(db, project_id=sample_project.id, title="Soon to be homeless")
        graph.remove_edge(db, sample_project.id, task.id, graph.REL_CONTAINS)
        db.commit()

        internal = client.get("/api/tasks/unfiled").json()
        external = client.get("/api/v1/tasks/unfiled", headers=_hdr(write_key)).json()
        assert [t["id"] for t in internal] == [t["id"] for t in external] == [task.id]

    def test_filing_through_v1_empties_the_bucket(self, client, db, sample_project, write_key):
        task = make_task(db, project_id=sample_project.id, title="Homeless")
        graph.remove_edge(db, sample_project.id, task.id, graph.REL_CONTAINS)
        db.commit()

        resp = client.post(f"/api/v1/tasks/{task.id}/memberships/{sample_project.id}", headers=_hdr(write_key))
        assert resp.status_code == 201
        assert client.get("/api/tasks/unfiled").json() == []

    def test_filing_is_idempotent(self, client, db, sample_project, write_key):
        task = make_task(db, project_id=sample_project.id, title="Already filed")
        resp = client.post(f"/api/v1/tasks/{task.id}/memberships/{sample_project.id}", headers=_hdr(write_key))
        assert resp.status_code == 201

    def test_the_literal_bucket_is_not_swallowed_by_the_task_id_route(self, client, db, write_key):
        """``/tasks/unfiled`` and ``/tasks/{task_id}/...`` share a prefix (ADR-0086)."""
        resp = client.get("/api/v1/tasks/unfiled", headers=_hdr(write_key))
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestDecisionRecords:
    @pytest.fixture()
    def decision(self, db, sample_project):
        d = graph.create_decision(
            db,
            sample_project.id,
            name="Use Postgres",
            description="## Context\nSQLite locks.\n",
            decision_status="accepted",
        )
        db.commit()
        return d

    def test_both_doors_list_the_same_records(self, client, decision, read_key):
        internal = client.get("/api/decisions").json()
        external = client.get("/api/v1/decisions", headers=_hdr(read_key)).json()
        assert [d["id"] for d in internal] == [d["id"] for d in external] == [decision.id]

    def test_the_export_is_markdown_under_the_adr_headings(self, client, decision, read_key):
        resp = client.get(f"/api/v1/decisions/{decision.id}/export", headers=_hdr(read_key))
        assert resp.status_code == 200
        assert resp.text.startswith("# Use Postgres")
        assert "## Status\nAccepted" in resp.text
        assert client.get(f"/api/decisions/{decision.id}/export").text == resp.text

    def test_a_missing_record_is_404_at_both_doors(self, client, read_key):
        internal = client.get("/api/decisions/nope")
        external = client.get("/api/v1/decisions/nope", headers=_hdr(read_key))
        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]

    def test_a_plain_label_is_not_a_decision(self, client, db, sample_project, read_key):
        label = graph.create_label(db, sample_project.id, name="bug")
        db.commit()
        assert client.get(f"/api/v1/decisions/{label.id}", headers=_hdr(read_key)).status_code == 404


class TestCycleRollover:
    @pytest.fixture()
    def cycle(self, db, sample_project):
        c = graph.create_cycle(db, sample_project.id, name="Sprint 3", status="active")
        task = make_task(db, project_id=sample_project.id, title="Carry me", priority="high")
        graph.update_task(db, task.id, status="done", time_spent=90)
        graph.add_to_cycle(db, c.id, task.id)
        db.commit()
        return c

    def test_duplicating_through_v1_produces_a_draft_of_todo_copies(self, client, db, sample_project, cycle, write_key):
        resp = client.post(f"/api/v1/projects/{sample_project.id}/cycles/{cycle.id}/duplicate", headers=_hdr(write_key))
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Sprint 3 (copy)"
        assert body["status"] == "draft"
        assert body["total_tasks"] == 1
        # The plan is copied, not the history.
        assert body["done_tasks"] == 0

    def test_the_copy_carries_priority_but_not_time_spent(self, client, db, sample_project, cycle, write_key):
        new_id = client.post(
            f"/api/v1/projects/{sample_project.id}/cycles/{cycle.id}/duplicate", headers=_hdr(write_key)
        ).json()["id"]
        copied = client.get(f"/api/v1/projects/{sample_project.id}/cycles/{new_id}", headers=_hdr(write_key)).json()
        task_id = copied["task_ids"][0]
        task = client.get(f"/api/v1/projects/{sample_project.id}/tasks/{task_id}", headers=_hdr(write_key)).json()
        assert task["priority"] == "high"
        assert task["status"] == "todo"
        assert not task["time_spent"]

    def test_a_missing_cycle_is_refused_identically(self, client, db, sample_project, write_key):
        internal = client.post(f"/api/projects/{sample_project.id}/cycles/nope/duplicate")
        external = client.post(f"/api/v1/projects/{sample_project.id}/cycles/nope/duplicate", headers=_hdr(write_key))
        assert internal.status_code == external.status_code == 404
        assert internal.json()["detail"] == external.json()["detail"]

    def test_duplicating_needs_write_scope(self, client, db, sample_project, cycle, read_key):
        resp = client.post(f"/api/v1/projects/{sample_project.id}/cycles/{cycle.id}/duplicate", headers=_hdr(read_key))
        assert resp.status_code == 403
