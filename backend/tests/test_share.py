from datetime import UTC, datetime, timedelta

import pytest

from app.models import ActivityLog, Comment, Project, ProjectIdentity, Task
from app.services.rate_limiter import _share_limiter


@pytest.fixture(autouse=True)
def _reset_share_rate_limit():
    _share_limiter._hits.clear()
    yield


def test_get_share_valid_token(client, sample_identity, sample_project):
    resp = client.get(f"/share/identity/{sample_identity.share_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["identity"]["name"] == "Test User"
    assert data["meta"]["requires_pin"] is False
    assert data["summary"]["total_projects"] == 1


def test_get_project_share_only_returns_that_project(client, db, sample_identity, sample_project):
    other = Project(name="Other Project")
    db.add(other)
    db.flush()
    db.add(ProjectIdentity(project_id=other.id, identity_id=sample_identity.id))
    db.commit()
    db.refresh(sample_project)

    resp = client.get(f"/share/project/{sample_project.share_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["scope"] == "project"
    assert data["summary"]["total_projects"] == 1
    assert [p["id"] for p in data["projects"]] == [sample_project.id]


def test_get_share_invalid_token(client):
    resp = client.get("/share/identity/nonexistent-token")
    assert resp.status_code == 404


def test_get_share_expired(client, db):
    from app.models import Identity

    identity = Identity(
        name="Expired",
        share_token="expired-token",
        share_expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(identity)
    db.commit()
    resp = client.get("/share/identity/expired-token")
    assert resp.status_code == 410


def test_get_share_pin_required(client, pinned_identity):
    resp = client.get(f"/share/identity/{pinned_identity.share_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["requires_pin"] is True
    assert "projects" not in data


def test_verify_pin_correct(client, pinned_identity):
    resp = client.post(
        f"/share/identity/{pinned_identity.share_token}/verify",
        json={"pin": "1234"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["requires_pin"] is False
    assert "share_session" in resp.cookies


def test_verify_pin_handles_naive_due_date(client, db, pinned_identity):
    project = Project(name="Pinned Project")
    db.add(project)
    db.flush()
    db.add(ProjectIdentity(project_id=project.id, identity_id=pinned_identity.id))
    db.add(
        Task(
            project_id=project.id,
            title="Overdue naive task",
            status="todo",
            due_date=datetime.now() - timedelta(days=1),
        )
    )
    db.commit()

    resp = client.post(
        f"/share/identity/{pinned_identity.share_token}/verify",
        json={"pin": "1234"},
    )

    assert resp.status_code == 200
    assert resp.json()["summary"]["overdue_tasks"] == 1


def test_verify_pin_wrong(client, pinned_identity):
    resp = client.post(
        f"/share/identity/{pinned_identity.share_token}/verify",
        json={"pin": "9999"},
    )
    assert resp.status_code == 403


def test_verify_pin_invalid_format(client, pinned_identity):
    resp = client.post(
        f"/share/identity/{pinned_identity.share_token}/verify",
        json={"pin": "abc"},
    )
    assert resp.status_code == 422


def test_view_logging_throttle(client, db, sample_identity, sample_project):
    token = sample_identity.share_token
    client.get(f"/share/identity/{token}")
    client.get(f"/share/identity/{token}")

    logs = db.query(ActivityLog).filter(ActivityLog.action == "share.viewed").all()
    assert len(logs) == 1  # throttled to 1 per IP per hour


# ── Guest notes ──────────────────────────────────────────────────


def test_guest_note_rejected_when_disabled(client, db, sample_project):
    task = Task(project_id=sample_project.id, title="Hidden thread")
    db.add(task)
    db.flush()
    db.add(Comment(task_id=task.id, project_id=sample_project.id, author="me", body="internal"))
    db.commit()

    resp = client.post(
        f"/share/project/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hello"},
    )
    assert resp.status_code == 403

    page = client.get(f"/share/project/{sample_project.share_token}").json()
    assert page["meta"]["guest_notes_enabled"] is False
    task_out = page["projects"][0]["tasks"][0]
    assert task_out["comment_count"] == 1
    assert task_out["comments"] == []  # comment bodies stay private when notes are off


def test_project_note_created_and_visible(client, db, sample_project):
    sample_project.allow_guest_notes = True
    db.commit()

    resp = client.post(
        f"/share/project/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Nice work!"},
    )
    assert resp.status_code == 201
    note = resp.json()
    assert note["guest_name"] == "Visitor"
    assert note["is_guest"] is True

    page = client.get(f"/share/project/{sample_project.share_token}").json()
    assert page["meta"]["guest_notes_enabled"] is True
    assert [n["body"] for n in page["projects"][0]["notes"]] == ["Nice work!"]

    log = db.query(ActivityLog).filter(ActivityLog.action == "share.note").one()
    assert log.actor.startswith("visitor:")


def test_task_note_created_and_visible(client, db, sample_project):
    sample_project.allow_guest_notes = True
    task = Task(project_id=sample_project.id, title="Shared task")
    db.add(task)
    db.commit()

    resp = client.post(
        f"/share/project/{sample_project.share_token}/tasks/{task.id}/notes",
        json={"guest_name": "Visitor", "body": "Question about this"},
    )
    assert resp.status_code == 201

    page = client.get(f"/share/project/{sample_project.share_token}").json()
    task_out = page["projects"][0]["tasks"][0]
    assert task_out["comment_count"] == 1
    assert task_out["comments"][0]["guest_name"] == "Visitor"
    assert task_out["comments"][0]["is_guest"] is True


def test_identity_note_requires_project_in_scope(client, db, sample_identity, sample_project):
    sample_identity.allow_guest_notes = True
    other = Project(name="Not shared")
    db.add(other)
    db.commit()

    resp = client.post(
        f"/share/identity/{sample_identity.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hi", "project_id": other.id},
    )
    assert resp.status_code == 404

    resp = client.post(
        f"/share/identity/{sample_identity.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hi", "project_id": sample_project.id},
    )
    assert resp.status_code == 201


def test_task_note_outside_scope_rejected(client, db, sample_project):
    sample_project.allow_guest_notes = True
    other = Project(name="Other")
    db.add(other)
    db.flush()
    foreign_task = Task(project_id=other.id, title="Foreign")
    db.add(foreign_task)
    db.commit()

    resp = client.post(
        f"/share/project/{sample_project.share_token}/tasks/{foreign_task.id}/notes",
        json={"guest_name": "Visitor", "body": "sneaky"},
    )
    assert resp.status_code == 404


def test_pinned_identity_note_requires_session(client, db, pinned_identity, sample_project):
    pinned_identity.allow_guest_notes = True
    db.add(ProjectIdentity(project_id=sample_project.id, identity_id=pinned_identity.id))
    db.commit()
    payload = {"guest_name": "Visitor", "body": "hello", "project_id": sample_project.id}

    resp = client.post(f"/share/identity/{pinned_identity.share_token}/notes", json=payload)
    assert resp.status_code == 403

    client.post(f"/share/identity/{pinned_identity.share_token}/verify", json={"pin": "1234"})
    resp = client.post(f"/share/identity/{pinned_identity.share_token}/notes", json=payload)
    assert resp.status_code == 201


def test_guest_note_blank_body_rejected(client, db, sample_project):
    sample_project.allow_guest_notes = True
    db.commit()

    resp = client.post(
        f"/share/project/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "   "},
    )
    assert resp.status_code == 422


def test_guest_note_daily_limit(client, db, sample_project):
    sample_project.allow_guest_notes = True
    db.commit()

    for i in range(20):
        resp = client.post(
            f"/share/project/{sample_project.share_token}/notes",
            json={"guest_name": "Visitor", "body": f"note {i}"},
        )
        assert resp.status_code == 201

    resp = client.post(
        f"/share/project/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "one too many"},
    )
    assert resp.status_code == 429


def test_project_share_expired_returns_410(client, db, sample_project):
    sample_project.share_expires_at = datetime.now(UTC) - timedelta(hours=1)
    db.commit()
    resp = client.get(f"/share/project/{sample_project.share_token}")
    assert resp.status_code == 410


def test_project_share_future_expiry_still_works(client, db, sample_project):
    sample_project.share_expires_at = datetime.now(UTC) + timedelta(days=1)
    db.commit()
    resp = client.get(f"/share/project/{sample_project.share_token}")
    assert resp.status_code == 200


def test_project_guest_note_blocked_after_expiry(client, db, sample_project):
    sample_project.allow_guest_notes = True
    sample_project.share_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    resp = client.post(
        f"/share/project/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "late note"},
    )
    assert resp.status_code == 410


def test_set_project_expiry_endpoint(client, db, sample_project):
    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    resp = client.post(f"/projects/{sample_project.id}/set-expiry", json={"expires_at": when})
    assert resp.status_code == 200
    db.refresh(sample_project)
    assert sample_project.share_expires_at is not None

    # Clearing sets it back to null.
    resp = client.post(f"/projects/{sample_project.id}/set-expiry", json={"expires_at": None})
    assert resp.status_code == 200
    db.refresh(sample_project)
    assert sample_project.share_expires_at is None


def test_project_share_view_count(client, db, sample_project):
    assert client.get(f"/projects/{sample_project.id}/share-views").json()["view_count"] == 0
    # A public view is logged and counted.
    client.get(f"/share/project/{sample_project.share_token}")
    assert client.get(f"/projects/{sample_project.id}/share-views").json()["view_count"] == 1
