"""Tests for the iCal feeds: global (all), identity, and project scopes."""

from datetime import UTC, datetime, timedelta

from tests.factories import make_task


def _add_task(db, project, **kwargs):
    task = make_task(db, project_id=project.id, title=kwargs.pop("title", "Task"), **kwargs)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


# --- project feed (reuses Project.share_token) ---------------------------------


def test_project_feed_requires_valid_token(client, sample_project):
    assert client.get("/ical/project/does-not-exist.ics").status_code == 404


def test_project_feed_served_by_share_token(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Ship it", due_date=due)

    resp = client.get(f"/ical/project/{sample_project.share_token}.ics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    body = resp.text
    assert "BEGIN:VCALENDAR" in body
    assert f"X-WR-CALNAME:{sample_project.name}" in body
    assert "SUMMARY:Ship it" in body


def test_events_are_timed_not_all_day(client, db, sample_project):
    due = datetime(2026, 7, 11, 14, 30, tzinfo=UTC)
    _add_task(db, sample_project, title="Timed", due_date=due)

    body = client.get(f"/ical/project/{sample_project.share_token}.ics").text
    assert "DTSTART:20260711T143000Z" in body
    assert "VALUE=DATE" not in body


def test_alarm_present_for_open_tasks(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Open", due_date=due, status="todo")

    body = client.get(f"/ical/project/{sample_project.share_token}.ics?alarm=45").text
    assert "BEGIN:VALARM" in body
    assert "TRIGGER:-PT45M" in body


def test_alarm_disabled_with_zero(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Open", due_date=due, status="todo")

    body = client.get(f"/ical/project/{sample_project.share_token}.ics?alarm=0").text
    assert "BEGIN:VALARM" not in body


def test_no_alarm_for_completed_tasks(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Done", due_date=due, status="done")

    body = client.get(f"/ical/project/{sample_project.share_token}.ics").text
    assert "BEGIN:VALARM" not in body


def test_no_status_field_for_cross_client_parity(client, db, sample_project):
    # STATUS is omitted so Apple/Google render every task as a plain event
    # (STATUS:CANCELLED can hide/strike events inconsistently).
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="A", due_date=due, status="done")
    _add_task(db, sample_project, title="B", due_date=due, status="failed")

    body = client.get(f"/ical/project/{sample_project.share_token}.ics").text
    assert "STATUS:" not in body


def test_long_cjk_summary_is_folded(client, db, sample_project):
    # A long multibyte title exceeds 75 octets and must be folded onto
    # continuation lines (each beginning with a space) to stay valid.
    due = datetime.now(UTC) + timedelta(days=1)
    long_title = "工作" * 20  # 40 CJK chars ~= 120 octets
    _add_task(db, sample_project, title=long_title, due_date=due)

    body = client.get(f"/ical/project/{sample_project.share_token}.ics").text
    assert "\r\n " in body  # folded continuation line present
    for line in body.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75


def test_special_characters_are_escaped(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="A, B; C\\D", due_date=due)

    body = client.get(f"/ical/project/{sample_project.share_token}.ics").text
    assert "SUMMARY:A\\, B\\; C\\\\D" in body


# --- identity feed (reuses Identity.share_token) -------------------------------


def test_identity_feed_aggregates_projects(client, db, sample_identity, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Under identity", due_date=due)

    resp = client.get(f"/ical/identity/{sample_identity.share_token}.ics")
    assert resp.status_code == 200
    assert "SUMMARY:Under identity" in resp.text
    assert f"X-WR-CALNAME:{sample_identity.name}" in resp.text


def test_identity_feed_requires_valid_token(client):
    assert client.get("/ical/identity/nope.ics").status_code == 404


# --- global feed (app-level token from /settings/ical-token) -------------------


def test_global_feed_includes_all_tasks(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Anywhere", due_date=due)

    token = client.get("/api/settings/ical-token").json()["token"]
    resp = client.get(f"/ical/all/{token}.ics")
    assert resp.status_code == 200
    assert "SUMMARY:Anywhere" in resp.text


def test_global_feed_rejects_bad_token(client):
    assert client.get("/ical/all/wrong-token.ics").status_code == 404


def test_global_token_is_stable(client):
    first = client.get("/api/settings/ical-token").json()["token"]
    second = client.get("/api/settings/ical-token").json()["token"]
    assert first == second


def test_rotate_global_token_revokes_old_url(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="X", due_date=due)
    old = client.get("/api/settings/ical-token").json()["token"]

    new = client.post("/api/settings/ical-token/rotate").json()["token"]
    assert new != old
    assert client.get(f"/ical/all/{old}.ics").status_code == 404
    assert client.get(f"/ical/all/{new}.ics").status_code == 200


# --- generic node feed (ADR-0039) ---------------------------------------------


def test_node_feed_unknown_token_404(client):
    assert client.get("/ical/node/nope.ics").status_code == 404


def test_node_feed_serves_custom_subscribable_container(client, db):
    from app.models import NodeType
    from app.services import graph

    db.add(NodeType(key="topic", label="Topic", is_builtin=False,
                    is_container=True, is_subscribable=True))
    db.commit()
    topic = graph.create_node(db, "topic", title="Launch", status="active", share_token="tok-cal")
    due = datetime.now(UTC) + timedelta(days=1)
    task = make_task(db, title="Ship it", due_date=due)
    graph.add_edge(db, topic.id, task.id, graph.REL_CONTAINS)
    db.commit()

    resp = client.get("/ical/node/tok-cal.ics")
    assert resp.status_code == 200
    assert "Ship it" in resp.text
    assert "X-WR-CALNAME:Launch" in resp.text


def test_node_feed_dispatches_identity_and_project(client, db, sample_identity, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="ProjTask", due_date=due)
    proj = client.get(f"/ical/node/{sample_project.share_token}.ics")
    assert proj.status_code == 200
    assert "ProjTask" in proj.text
    ident = client.get(f"/ical/node/{sample_identity.share_token}.ics")
    assert ident.status_code == 200
