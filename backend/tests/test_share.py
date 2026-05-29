from datetime import UTC, datetime, timedelta

from app.models import ActivityLog


def test_get_share_valid_token(client, sample_identity, sample_project):
    resp = client.get(f"/share/identity/{sample_identity.share_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["identity"]["name"] == "Test User"
    assert data["meta"]["requires_pin"] is False
    assert data["summary"]["total_projects"] == 1


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
