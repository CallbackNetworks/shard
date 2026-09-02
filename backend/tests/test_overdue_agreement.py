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

# Three open tasks are past due. The failed one is *not* late — it is failed, and
# already counted under its own status. The done one finished, late or not. The
# open one due later has not come round yet.
#
# The unset-status row is the case this file was missing (ADR-0142). ``Node.status``
# is nullable with no column default, so NULL is a value the database really holds —
# and it is the only one at which the SQL and Python forms of this rule disagreed,
# because ``NULL NOT IN ('done', 'failed')`` is NULL rather than true. Every other
# case here is answered identically by a filter that has the bug and one that does
# not, which is why six rows of them missed it.
CASES = [
    ("open and late", "todo", PAST),
    ("in flight and late", "in_progress", PAST),
    ("unset status, and late", None, PAST),
    ("failed and late", "failed", PAST),
    ("done and late", "done", PAST),
    ("open, due later", "todo", FUTURE),
    ("open, no due date", "todo", None),
]
EXPECTED_OVERDUE = 4  # three open tasks past due, plus one task-like `incident`


@pytest.fixture()
def read_key(db):
    raw = "tdp_overdue_agreement_key"
    db.add(
        ApiKey(
            name="Read Key",
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


def test_a_task_with_no_status_is_still_open(db, dated_project):
    """The other exact disagreement: NULL is open, and SQL did not think so.

    ``Node.status`` is nullable and carries no default, so this is not a hypothetical
    row — production holds ten of them. ``is_overdue`` and the frontend both read an
    unset status as open (``None`` is not in the closed list); the SQL filter dropped
    the row entirely, because three-valued logic makes ``NULL NOT IN (...)`` unknown
    rather than true. Same word, same task, two answers — ADR-0089's defect at the one
    value ADR-0089 did not test.
    """
    from app.models import Node

    now = datetime.now(UTC)
    unset = next(
        node for tid in graph.subtree_task_ids(db, dated_project.id) if (node := db.get(Node, tid)).status is None
    )
    assert unset.due_date is not None
    assert graph.is_overdue(unset, now) is True
    assert graph.is_closed(unset.status) is False

    reached = db.query(Node).filter(Node.id == unset.id, *graph.overdue_clause(now)).count()
    assert reached == 1, "the SQL form of the rule must keep the row its Python form keeps"


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


def test_the_public_share_page_agrees(client, db, dated_project):
    """The surface the owner never reads, and the last one still on the old rule.

    ``share.py`` counted ``status != "done"``, which ADR-0089 replaced — so a failed,
    past-due task was overdue on the public page and nowhere else. Every other reporting
    surface was asked this question when ADR-0089 shipped; this one was not, which is the
    only reason it kept the old answer (ADR-0120).
    """
    from app.models import Node

    node = db.get(Node, dated_project.id)
    token = (node.data or {}).get("share_token")
    assert token, "a project is seeded with a share token at creation (ADR-0041)"

    body = client.get(f"/share/node/{token}").json()
    assert body["summary"]["overdue_tasks"] == EXPECTED_OVERDUE


def test_no_hand_written_copy_of_the_closed_status_filter():
    """A fifth copy of "still open" as SQL must not appear (ADR-0142).

    ``overdue_clause`` read the rule from ``CLOSED_STATUSES``; three other queries —
    the critical path, the due-date reminder sweep and the daily summary's "due today"
    — spelled ``["done", "failed"]`` out by hand. Being literals they were invisible to
    a search for the constant, and each carried the NULL bug independently, so an unset
    task could never be reminded about or escalated.

    Scanned rather than asserted behaviourally because the defect is duplication, not a
    wrong answer: a fifth copy written tomorrow would be correct on the day it lands.
    """
    import pathlib

    app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"
    offenders = []
    for path in app_dir.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), 1):
            if "status.notin_(" in line or 'notin_(["done"' in line:
                # core.py owns the rule; everything else must call it.
                if path.name == "core.py" and "graph" in path.parts:
                    continue
                offenders.append(f"{path.relative_to(app_dir)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "these spell out the closed-status filter instead of calling "
        "graph.open_status_clause(), which also means they drop unset-status rows:\n  " + "\n  ".join(offenders)
    )
