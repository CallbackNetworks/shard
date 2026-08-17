"""One meaning of "overdue", on every surface that reports it (ADR-0089).

The backend has always used ``due_date < now AND status NOT IN (done, failed)``.
The frontend counted ``status != 'done'``, so a *failed* task past its due date
was overdue in the dashboard and not overdue in the analytics page — the same
word, the same tasks, two numbers (91 and 81 on the development database). A
third copy, the "Overdue" filter, checked no status at all and listed finished
work.

The rule now lives in ``graph.overdue_clause`` / ``graph.is_overdue`` here and in
``frontend/src/utils/overdue.js`` there, each with a test that pins it. This file
pins the half that can be executed in Python: build one project holding every
interesting case, then ask each surface how many tasks are overdue.
"""

import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from app.models import ApiKey
from app.services import graph
from tests.factories import make_project, make_task

PAST = datetime.now(UTC) - timedelta(days=3)
FUTURE = datetime.now(UTC) + timedelta(days=3)

# Two open tasks are past due. The failed one is *not* late — it is failed, and
# already counted under its own status. The done one finished, late or not. The
# open one due later has not come round yet.
CASES = [
    ("open and late", "todo", PAST),
    ("in flight and late", "in_progress", PAST),
    ("failed and late", "failed", PAST),
    ("done and late", "done", PAST),
    ("open, due later", "todo", FUTURE),
    ("open, no due date", "todo", None),
]
EXPECTED_OVERDUE = 3  # two open tasks past due, plus one task-like `incident`


@pytest.fixture()
def read_key(db):
    raw = "tdp_overdue_agreement_key"
    db.add(
        ApiKey(
            name="Read Key",
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            active=True,
        )
    )
    db.commit()
    return {"X-API-Key": raw}


@pytest.fixture()
def dated_project(client, db, sample_identity):
    project = make_project(db, name="Deadlines")
    for title, status, due in CASES:
        make_task(db, project_id=project.id, title=title, status=status, due_date=due)
    graph.add_edge(db, sample_identity.id, project.id, graph.REL_OWNS)
    db.commit()
    # A custom type that declares the task role is a first-class task everywhere
    # (ADR-0033/0035). The analytics queries used to count the literal ``task``
    # type only, so one of these went missing from every figure — the last two of
    # the ten tasks by which the dashboard and the analytics page disagreed.
    client.post("/api/graph-types/nodes", json={"key": "incident", "label": "Incident", "roles": ["task"]})
    client.post(
        "/api/nodes",
        json={
            "type": "incident",
            "title": "incident, open and late",
            "status": "todo",
            "due_date": PAST.isoformat(),
            "container_id": project.id,
        },
    )
    db.commit()
    return project


def test_the_rule_itself(db, dated_project):
    now = datetime.now(UTC)
    tasks = [db.get(type(dated_project), tid) for tid in graph.subtree_task_ids(db, dated_project.id)]
    assert sum(1 for t in tasks if graph.is_overdue(t, now)) == EXPECTED_OVERDUE


def test_a_failed_task_is_not_overdue(db, dated_project):
    """The exact disagreement: this is the task the two ends counted differently."""
    now = datetime.now(UTC)
    failed = next(
        db.get(type(dated_project), tid)
        for tid in graph.subtree_task_ids(db, dated_project.id)
        if db.get(type(dated_project), tid).status == "failed"
    )
    assert failed.due_date is not None
    assert failed.due_date.replace(tzinfo=None) < now.replace(tzinfo=None)
    assert graph.is_overdue(failed, now) is False


def test_the_query_and_the_predicate_agree(db, dated_project):
    """``overdue_clause`` (SQL) and ``is_overdue`` (Python) are one rule, stated twice."""
    from app.models import Node

    now = datetime.now(UTC)
    by_query = db.query(Node).filter(graph.task_type_filter(db), *graph.overdue_clause(now)).count()
    by_predicate = sum(1 for t in db.query(Node).filter(graph.task_type_filter(db)).all() if graph.is_overdue(t, now))
    assert by_query == by_predicate == EXPECTED_OVERDUE


def test_internal_analytics_agrees(client, dated_project):
    assert client.get("/api/analytics/overview").json()["overdue_tasks"] == EXPECTED_OVERDUE


def test_external_analytics_agrees(client, dated_project, read_key):
    body = client.get("/api/v1/analytics/overview", headers=read_key).json()
    assert body["overdue_tasks"] == EXPECTED_OVERDUE


def test_identity_hub_stats_agree(client, dated_project, sample_identity):
    body = client.get("/api/identities/hub-stats").json()
    identity = next(i for i in body["identities"] if i["id"] == str(sample_identity.id))
    assert identity["overdue"] == EXPECTED_OVERDUE


def test_external_project_stats_agree(client, dated_project, read_key):
    body = client.get(f"/api/v1/projects/{dated_project.id}/stats", headers=read_key).json()
    assert body["overdue_tasks"] == EXPECTED_OVERDUE


def test_external_summary_agrees(client, dated_project, read_key):
    body = client.get("/api/v1/summary", headers=read_key).json()
    project = next(p for p in body["projects"] if p["id"] == str(dated_project.id))
    assert project["overdue"] == EXPECTED_OVERDUE
