"""Tests for the token-protected iCal feed (bulk.ical_feed)."""

from datetime import UTC, datetime, timedelta

from app.models import Task


def _add_task(db, project, **kwargs):
    task = Task(project_id=project.id, title=kwargs.pop("title", "Task"), **kwargs)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_feed_requires_valid_share_token(client, sample_project):
    resp = client.get("/ical/does-not-exist.ics")
    assert resp.status_code == 404


def test_feed_served_by_share_token(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Ship it", due_date=due)

    resp = client.get(f"/ical/{sample_project.share_token}.ics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    body = resp.text
    assert "BEGIN:VCALENDAR" in body
    assert f"X-WR-CALNAME:{sample_project.name}" in body
    assert "SUMMARY:Ship it" in body


def test_events_are_timed_not_all_day(client, db, sample_project):
    due = datetime(2026, 7, 11, 14, 30, tzinfo=UTC)
    _add_task(db, sample_project, title="Timed", due_date=due)

    body = client.get(f"/ical/{sample_project.share_token}.ics").text
    assert "DTSTART:20260711T143000Z" in body
    assert "VALUE=DATE" not in body  # no longer all-day


def test_alarm_present_for_open_tasks(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Open", due_date=due, status="todo")

    body = client.get(f"/ical/{sample_project.share_token}.ics?alarm=45").text
    assert "BEGIN:VALARM" in body
    assert "TRIGGER:-PT45M" in body


def test_alarm_disabled_with_zero(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Open", due_date=due, status="todo")

    body = client.get(f"/ical/{sample_project.share_token}.ics?alarm=0").text
    assert "BEGIN:VALARM" not in body


def test_no_alarm_for_completed_tasks(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="Done", due_date=due, status="done")

    body = client.get(f"/ical/{sample_project.share_token}.ics").text
    assert "BEGIN:VALARM" not in body
    assert "STATUS:COMPLETED" in body


def test_special_characters_are_escaped(client, db, sample_project):
    due = datetime.now(UTC) + timedelta(days=1)
    _add_task(db, sample_project, title="A, B; C\\D", due_date=due)

    body = client.get(f"/ical/{sample_project.share_token}.ics").text
    assert "SUMMARY:A\\, B\\; C\\\\D" in body
