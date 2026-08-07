from datetime import UTC, datetime, timedelta

import pytest

from app.models import ActivityLog, Comment
from app.services import graph
from app.services.rate_limiter import _share_limiter
from tests.factories import make_project, make_task


@pytest.fixture(autouse=True)
def _reset_share_rate_limit():
    _share_limiter._hits.clear()
    yield


def test_get_share_valid_token(client, sample_identity, sample_project):
    resp = client.get(f"/share/node/{sample_identity.share_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["identity"]["name"] == "Test User"
    assert data["meta"]["requires_pin"] is False
    assert data["summary"]["total_projects"] == 1


def test_get_project_share_only_returns_that_project(client, db, sample_identity, sample_project):
    other = make_project(db, name="Other Project")
    db.add(other)
    db.flush()
    graph.link_membership(db, sample_identity.id, other.id)
    db.commit()
    db.refresh(sample_project)

    resp = client.get(f"/share/node/{sample_project.share_token}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["scope"] == "project"
    assert data["summary"]["total_projects"] == 1
    assert [p["id"] for p in data["projects"]] == [sample_project.id]


def test_get_share_invalid_token(client):
    resp = client.get("/share/node/nonexistent-token")
    assert resp.status_code == 404


def test_get_share_expired(client, db):
    from app.services import graph

    identity = graph.create_identity(db, name="Expired")
    graph.update_identity(
        db,
        identity.id,
        share_token="expired-token",
        share_expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.commit()
    resp = client.get("/share/node/expired-token")
    assert resp.status_code == 410


def test_get_share_pin_required(client, pinned_identity):
    resp = client.get(f"/share/node/{pinned_identity.share_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["requires_pin"] is True
    assert "projects" not in data


def test_verify_pin_correct(client, pinned_identity):
    resp = client.post(
        f"/share/node/{pinned_identity.share_token}/verify",
        json={"pin": "1234"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["meta"]["requires_pin"] is False
    assert "share_session" in resp.cookies


def test_verify_pin_handles_naive_due_date(client, db, pinned_identity):
    project = make_project(db, name="Pinned Project")
    db.add(project)
    db.flush()
    graph.link_membership(db, pinned_identity.id, project.id)
    db.add(
        make_task(
            db,
            project_id=project.id,
            title="Overdue naive task",
            status="todo",
            due_date=datetime.now() - timedelta(days=1),
        )
    )
    db.commit()

    resp = client.post(
        f"/share/node/{pinned_identity.share_token}/verify",
        json={"pin": "1234"},
    )

    assert resp.status_code == 200
    assert resp.json()["summary"]["overdue_tasks"] == 1


def test_verify_pin_wrong(client, pinned_identity):
    resp = client.post(
        f"/share/node/{pinned_identity.share_token}/verify",
        json={"pin": "9999"},
    )
    assert resp.status_code == 403


def test_verify_pin_invalid_format(client, pinned_identity):
    resp = client.post(
        f"/share/node/{pinned_identity.share_token}/verify",
        json={"pin": "abc"},
    )
    assert resp.status_code == 422


def test_view_logging_throttle(client, db, sample_identity, sample_project):
    token = sample_identity.share_token
    client.get(f"/share/node/{token}")
    client.get(f"/share/node/{token}")

    logs = db.query(ActivityLog).filter(ActivityLog.action == "share.viewed").all()
    assert len(logs) == 1  # throttled to 1 per IP per hour


# ── Guest notes ──────────────────────────────────────────────────


def test_guest_note_rejected_when_disabled(client, db, sample_project):
    task = make_task(db, project_id=sample_project.id, title="Hidden thread")
    db.add(task)
    db.flush()
    db.add(Comment(task_id=task.id, project_id=sample_project.id, author="me", body="internal"))
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hello"},
    )
    assert resp.status_code == 403

    page = client.get(f"/share/node/{sample_project.share_token}").json()
    assert page["meta"]["guest_notes_enabled"] is False
    task_out = page["projects"][0]["tasks"][0]
    assert task_out["comment_count"] == 1
    assert task_out["comments"] == []  # comment bodies stay private when notes are off


def test_project_note_created_and_visible(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Nice work!"},
    )
    assert resp.status_code == 201
    note = resp.json()
    assert note["guest_name"] == "Visitor"
    assert note["is_guest"] is True

    page = client.get(f"/share/node/{sample_project.share_token}").json()
    assert page["meta"]["guest_notes_enabled"] is True
    assert [n["body"] for n in page["projects"][0]["notes"]] == ["Nice work!"]

    log = db.query(ActivityLog).filter(ActivityLog.action == "share.note").one()
    assert log.actor.startswith("visitor:")


def test_task_note_created_and_visible(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    task = make_task(db, project_id=sample_project.id, title="Shared task")
    db.add(task)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/tasks/{task.id}/notes",
        json={"guest_name": "Visitor", "body": "Question about this"},
    )
    assert resp.status_code == 201

    page = client.get(f"/share/node/{sample_project.share_token}").json()
    task_out = page["projects"][0]["tasks"][0]
    assert task_out["comment_count"] == 1
    assert task_out["comments"][0]["guest_name"] == "Visitor"
    assert task_out["comments"][0]["is_guest"] is True


def test_task_note_attributed_inside_share_scope(client, db, sample_project):
    """A cross-project task's note lands in a shared project, not its outside origin (ADR-0032)."""
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    other = make_project(db, name="Private origin")
    db.add(other)
    db.commit()
    # The task originates in the unshared project, then is linked into the shared one.
    tid = client.post("/api/nodes", json={"type": "task", "container_id": other.id, "title": "Cross"}).json()["id"]
    client.post(f"/api/projects/{other.id}/tasks/{tid}/memberships/{sample_project.id}")

    resp = client.post(
        f"/share/node/{sample_project.share_token}/tasks/{tid}/notes",
        json={"guest_name": "Visitor", "body": "hi"},
    )
    assert resp.status_code == 201
    note = db.query(Comment).filter(Comment.task_id == tid).one()
    assert note.project_id == sample_project.id


def test_identity_note_requires_project_in_scope(client, db, sample_identity, sample_project):
    graph.update_identity(db, sample_identity.id, allow_guest_notes=True)
    other = make_project(db, name="Not shared")
    db.add(other)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_identity.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hi", "project_id": other.id},
    )
    assert resp.status_code == 404

    resp = client.post(
        f"/share/node/{sample_identity.share_token}/notes",
        json={"guest_name": "Visitor", "body": "Hi", "project_id": sample_project.id},
    )
    assert resp.status_code == 201


def test_project_share_pin_is_enforced(client, db, sample_project):
    """A PIN set on a project actually protects its share page (ADR-0072).

    ``/api/nodes/{id}/share/set-pin`` always accepted a project — it is a shareable
    node — but ``ProjectView`` never read the hash back, so the page served straight
    through. A lock that can be set and does nothing is worse than no lock: the owner
    believes the share is protected.
    """
    token = sample_project.share_token
    assert client.get(f"/share/node/{token}").json()["meta"]["requires_pin"] is False

    assert client.post(f"/api/nodes/{sample_project.id}/share/set-pin", json={"pin": "8765"}).status_code == 200

    # Locked on both doors, and the payload carries nothing but the name.
    for path in (f"/share/node/{token}", f"/share/node/{token}"):
        body = client.get(path).json()
        assert body["meta"]["requires_pin"] is True, path
        assert "projects" not in body, path

    # The owner's own read says a PIN is set, without ever serving the hash.
    project_out = client.get(f"/api/projects/{sample_project.id}").json()
    assert project_out["share_pin_set"] is True
    assert "share_pin_hash" not in project_out

    # Wrong PIN stays locked; the right one unlocks and returns the project page.
    assert client.post(f"/share/node/{token}/verify", json={"pin": "0000"}).status_code == 403
    unlocked = client.post(f"/share/node/{token}/verify", json={"pin": "8765"})
    assert unlocked.status_code == 200
    assert [p["id"] for p in unlocked.json()["projects"]] == [sample_project.id]

    # ...and the cookie it minted opens the page.
    assert client.get(f"/share/node/{token}").json()["meta"]["requires_pin"] is False

    assert client.delete(f"/api/nodes/{sample_project.id}/share/pin").status_code == 200
    assert client.get(f"/api/projects/{sample_project.id}").json()["share_pin_set"] is False


def test_pinned_project_note_requires_session(client, db, sample_project):
    """The note gate follows the page gate — one is not a way around the other."""
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    db.commit()
    client.post(f"/api/nodes/{sample_project.id}/share/set-pin", json={"pin": "8765"})
    payload = {"guest_name": "Visitor", "body": "hello"}

    resp = client.post(f"/share/node/{sample_project.share_token}/notes", json=payload)
    assert resp.status_code == 403

    client.post(f"/share/node/{sample_project.share_token}/verify", json={"pin": "8765"})
    resp = client.post(f"/share/node/{sample_project.share_token}/notes", json=payload)
    assert resp.status_code == 201


def test_verify_through_generic_door_returns_the_identity_page(client, db, pinned_identity, sample_project):
    """Unlocking a page hands back that page (ADR-0070).

    The generic verify was written container-only, so an identity — whose projects
    hang off ``member_of``, not ``contains`` — unlocked into an empty page.
    """
    graph.link_membership(db, pinned_identity.id, sample_project.id)
    db.commit()

    resp = client.post(f"/share/node/{pinned_identity.share_token}/verify", json={"pin": "1234"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["requires_pin"] is False
    assert [p["id"] for p in body["projects"]] == [sample_project.id]
    # Same page the GET serves once the cookie is set.
    assert body["projects"] == client.get(f"/share/node/{pinned_identity.share_token}").json()["projects"]


@pytest.mark.parametrize("retired", ["identity", "project"])
def test_entity_shaped_public_paths_are_gone(client, sample_identity, sample_project, retired):
    """One public door for every shareable node (ADR-0070, ADR-0071, ADR-0073).

    The identity- and project-flavoured paths are retired; /share/node and /ical/node
    serve both, dispatching on the token's node type.
    """
    token = (sample_identity if retired == "identity" else sample_project).share_token

    assert client.get(f"/share/{retired}/{token}").status_code == 404
    assert client.post(f"/share/{retired}/{token}/verify", json={"pin": "1234"}).status_code == 404
    assert client.post(f"/share/{retired}/{token}/notes", json={"guest_name": "V", "body": "hi"}).status_code == 404
    assert client.get(f"/ical/{retired}/{token}.ics").status_code == 404

    assert client.get(f"/share/node/{token}").status_code == 200
    assert client.get(f"/ical/node/{token}.ics").status_code == 200


def test_entity_shaped_share_admin_endpoints_are_gone(client, sample_identity, sample_project):
    """The owner-side duplicates went with them: the panel reads /api/nodes/{id}/share*."""
    assert client.get(f"/api/identities/{sample_identity.id}/share-views").status_code == 404
    assert client.get(f"/api/projects/{sample_project.id}/share-views").status_code == 404
    assert client.post(f"/api/projects/{sample_project.id}/set-expiry", json={"expires_at": None}).status_code == 404

    assert client.get(f"/api/nodes/{sample_identity.id}/share-views").status_code == 200
    assert client.get(f"/api/nodes/{sample_project.id}/share-views").status_code == 200


def test_note_on_a_project_share_needs_no_project_id(client, db, sample_project):
    """A share holding one project disambiguates itself (ADR-0073).

    ``project_id`` used to be required for every scope but ``project``; with the scopes
    collapsed, a single-project share must still accept a note without one.
    """
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "no project_id given"},
    )
    assert resp.status_code == 201


def test_guest_notes_work_on_a_custom_shareable_container(client, db, sample_project):
    """The generic door must accept writes on every type it serves, not just reads."""
    from app.models import NodeType

    db.add(NodeType(key="topic", label="Topic", is_builtin=False, roles=["container", "shareable"]))
    db.commit()
    node = client.post("/api/nodes", json={"type": "topic", "title": "Launch"}).json()
    task = make_task(db, project_id=sample_project.id, title="Owned by topic")
    db.add(task)
    db.commit()
    client.post(f"/api/nodes/{node['id']}/edges", json={"target_id": task.id, "rel_type": "contains"})
    token = client.post(f"/api/nodes/{node['id']}/share/rotate-token").json()["share_token"]

    payload = {"guest_name": "Visitor", "body": "Nice", "project_id": node["id"]}
    assert client.post(f"/share/node/{token}/notes", json=payload).status_code == 403  # notes off by default

    client.post(f"/api/nodes/{node['id']}/share/set-guest-notes", json={"allowed": True})
    assert client.post(f"/share/node/{token}/notes", json=payload).status_code == 201
    assert client.post(f"/share/node/{token}/tasks/{task.id}/notes", json=payload).status_code == 201


def test_task_note_outside_scope_rejected(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    other = make_project(db, name="Other")
    db.add(other)
    db.flush()
    foreign_task = make_task(db, project_id=other.id, title="Foreign")
    db.add(foreign_task)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/tasks/{foreign_task.id}/notes",
        json={"guest_name": "Visitor", "body": "sneaky"},
    )
    assert resp.status_code == 404


def test_pinned_identity_note_requires_session(client, db, pinned_identity, sample_project):
    graph.update_identity(db, pinned_identity.id, allow_guest_notes=True)
    graph.link_membership(db, pinned_identity.id, sample_project.id)
    db.commit()
    payload = {"guest_name": "Visitor", "body": "hello", "project_id": sample_project.id}

    resp = client.post(f"/share/node/{pinned_identity.share_token}/notes", json=payload)
    assert resp.status_code == 403

    client.post(f"/share/node/{pinned_identity.share_token}/verify", json={"pin": "1234"})
    resp = client.post(f"/share/node/{pinned_identity.share_token}/notes", json=payload)
    assert resp.status_code == 201


def test_guest_note_blank_body_rejected(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    db.commit()

    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "   "},
    )
    assert resp.status_code == 422


def test_guest_note_daily_limit(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    db.commit()

    for i in range(20):
        resp = client.post(
            f"/share/node/{sample_project.share_token}/notes",
            json={"guest_name": "Visitor", "body": f"note {i}"},
        )
        assert resp.status_code == 201

    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "one too many"},
    )
    assert resp.status_code == 429


def test_project_share_expired_returns_410(client, db, sample_project):
    graph.update_project(db, sample_project.id, share_expires_at=datetime.now(UTC) - timedelta(hours=1))
    db.commit()
    resp = client.get(f"/share/node/{sample_project.share_token}")
    assert resp.status_code == 410


def test_project_share_future_expiry_still_works(client, db, sample_project):
    graph.update_project(db, sample_project.id, share_expires_at=datetime.now(UTC) + timedelta(days=1))
    db.commit()
    resp = client.get(f"/share/node/{sample_project.share_token}")
    assert resp.status_code == 200


def test_project_guest_note_blocked_after_expiry(client, db, sample_project):
    graph.update_project(db, sample_project.id, allow_guest_notes=True)
    graph.update_project(db, sample_project.id, share_expires_at=datetime.now(UTC) - timedelta(minutes=1))
    db.commit()
    resp = client.post(
        f"/share/node/{sample_project.share_token}/notes",
        json={"guest_name": "Visitor", "body": "late note"},
    )
    assert resp.status_code == 410


def test_set_project_expiry_through_the_node_endpoint(client, db, sample_project):
    # Project is node-only (ADR-0033 B6): share_expires_at lives in node.data, so
    # read it back through the graph layer, not off the decorated node snapshot. The
    # project-shaped endpoint is gone (ADR-0073) — one share write surface for every type.
    when = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    resp = client.post(f"/api/nodes/{sample_project.id}/share/set-expiry", json={"expires_at": when})
    assert resp.status_code == 200
    assert graph.get_project(db, sample_project.id).share_expires_at is not None

    # Clearing sets it back to null.
    resp = client.post(f"/api/nodes/{sample_project.id}/share/set-expiry", json={"expires_at": None})
    assert resp.status_code == 200
    assert graph.get_project(db, sample_project.id).share_expires_at is None


@pytest.mark.parametrize("entity", ["identity", "project"])
def test_view_count_has_one_answer_per_node(client, db, sample_identity, sample_project, entity):
    """ "How many people saw this?" has one answer per node (ADR-0070, ADR-0073).

    There is one counting endpoint now, but ``share.viewed`` rows written before the
    doors collapsed name their subject under ``identity_id`` or ``project_id`` rather
    than ``node_id``. The count accepts all three, so history does not vanish when the
    route serving it does.
    """
    node = sample_identity if entity == "identity" else sample_project
    endpoint = f"/api/nodes/{node.id}/share-views"
    assert client.get(endpoint).json() == {"view_count": 0}

    # A view through today's only door.
    client.get(f"/share/node/{node.share_token}")
    assert client.get(endpoint).json()["view_count"] == 1

    # A row as the retired facades used to write it still counts.
    db.add(
        ActivityLog(
            action="share.viewed",
            actor="visitor:legacy",
            detail="written by a retired facade",
            meta={f"{entity}_id": node.id},
        )
    )
    db.commit()
    assert client.get(endpoint).json()["view_count"] == 2


def test_share_node_serves_custom_shareable_container(client, db):
    # ADR-0039: a user-defined shareable container is served by the generic
    # /share/node/{token} route with the same payload shape as a project share.
    from app.models import NodeType
    from app.services import graph

    db.add(NodeType(key="topic", label="Topic", is_builtin=False, roles=["container", "shareable"]))
    db.commit()
    topic = graph.create_node(db, "topic", title="Launch", status="active", share_token="tok-topic")
    task = make_task(db, title="Ship it", status="todo")
    graph.add_edge(db, topic.id, task.id, graph.REL_CONTAINS)
    db.commit()

    resp = client.get("/share/node/tok-topic")
    assert resp.status_code == 200
    data = resp.json()
    assert data["identity"]["name"] == "Launch"
    assert data["meta"]["scope"] == "node"
    titles = [t["title"] for p in data["projects"] for t in p["tasks"]]
    assert "Ship it" in titles


def test_share_node_dispatches_identity_and_project(client, sample_identity, sample_project):
    # The generic route delegates identity/project to their existing handlers.
    ident = client.get(f"/share/node/{sample_identity.share_token}")
    assert ident.status_code == 200
    assert ident.json()["meta"]["scope"] == "identity"

    proj = client.get(f"/share/node/{sample_project.share_token}")
    assert proj.status_code == 200
    assert proj.json()["meta"]["scope"] == "project"


def test_share_node_unknown_token_404(client):
    assert client.get("/share/node/nope").status_code == 404


def test_share_node_pin_gate_and_verify(client, db):
    # ADR-0039: a PIN-protected shareable container gates the page, and the
    # generic verify endpoint unlocks it with a session cookie.
    from app.models import NodeType
    from app.services import graph
    from app.services.pin_utils import hash_pin

    db.add(NodeType(key="topic", label="Topic", is_builtin=False, roles=["container", "shareable"]))
    db.commit()
    graph.create_node(
        db, "topic", title="Locked", status="active", share_token="tok-pin", share_pin_hash=hash_pin("2468")
    )
    db.commit()

    gated = client.get("/share/node/tok-pin")
    assert gated.status_code == 200
    assert gated.json()["meta"]["requires_pin"] is True

    assert client.post("/share/node/tok-pin/verify", json={"pin": "0000"}).status_code == 403
    ok = client.post("/share/node/tok-pin/verify", json={"pin": "2468"})
    assert ok.status_code == 200
    assert ok.json()["meta"]["scope"] == "node"


def test_share_node_verify_without_pin_400(client, db):
    from app.models import NodeType
    from app.services import graph

    db.add(NodeType(key="topic", label="Topic", is_builtin=False, roles=["container", "shareable"]))
    db.commit()
    graph.create_node(db, "topic", title="Open", status="active", share_token="tok-nopin")
    db.commit()
    assert client.post("/share/node/tok-nopin/verify", json={"pin": "1234"}).status_code == 400
