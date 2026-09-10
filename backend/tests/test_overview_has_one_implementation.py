"""The overview counts are computed once, and the ticker's three numbers come from them (ADR-0158).

``GET /api/analytics/overview`` and ``GET /api/v1/analytics/overview`` each carried their
own copy of the same nine counts, identical except for the key scoping the second applies.
Nothing was broken — which is the state ADR-0070 warns about, since a duplicate that still
agrees has no failure symptom. It acquired one the moment a count was added: the field
existed on one door and not the other, and the only way to find out was to call both.

The other half of this ADR is what the counts are *for*. ``GlobalActivityTicker`` derived
overdue/failed/high-priority in the browser from ``GET /projects`` with every task embedded
— a second implementation of ADR-0089's one rule, and 327KB on every page in the app to
reach three integers. So the counts it needs are asserted here, at the door it now reads.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.models import ApiKey
from tests.factories import make_task

import hashlib

# Every key the ticker and the analytics page read. A count added to the service and not
# to this list is not tested; a count in this list missing from either door fails.
OVERVIEW_FIELDS = {
    "total_projects",
    "active_projects",
    "total_tasks",
    "done_tasks",
    "in_progress_tasks",
    "overdue_tasks",
    "failed_tasks",
    "high_priority_active_tasks",
    "most_active_project",
}


@pytest.fixture()
def read_key(db):
    raw = "tdp_test_overview_read"
    db.add(
        ApiKey(
            name="overview_read",
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            active=True,
        )
    )
    db.commit()
    return raw


def _populate(db, project_id):
    past = datetime.now(UTC) - timedelta(days=2)
    db.add_all(
        [
            make_task(db, project_id=project_id, title="done", status="done"),
            make_task(db, project_id=project_id, title="failed", status="failed"),
            make_task(db, project_id=project_id, title="failed too", status="failed"),
            make_task(db, project_id=project_id, title="hot", status="in_progress", priority="high"),
            make_task(db, project_id=project_id, title="late", status="todo", due_date=past),
            # A failed task is not late; it is failed (ADR-0089).
            make_task(db, project_id=project_id, title="late but failed", status="failed", due_date=past),
        ]
    )
    db.commit()


def test_both_doors_answer_identically(client, db, sample_project, read_key):
    _populate(db, sample_project.id)

    internal = client.get("/api/analytics/overview")
    external = client.get("/api/v1/analytics/overview", headers={"X-API-Key": read_key})

    assert internal.status_code == 200
    assert external.status_code == 200
    assert set(internal.json()) == OVERVIEW_FIELDS
    assert internal.json() == external.json()


def test_the_three_numbers_the_ticker_draws(client, db, sample_project):
    _populate(db, sample_project.id)
    data = client.get("/api/analytics/overview").json()

    assert data["failed_tasks"] == 3  # the two failed, plus the one that was also late
    assert data["overdue_tasks"] == 1  # "late" only — a failed task is not late
    assert data["high_priority_active_tasks"] == 1


def test_an_unset_status_is_active(client, db, sample_project):
    """``Node.status`` is nullable, and SQL drops NULL from a ``NOT IN`` (ADR-0142).

    The browser's version of this count read ``!['done','failed'].includes(status)``,
    which keeps an unset status. A server-side ``notin_`` would silently disagree, and
    the ticker would report a smaller number than the board shows — the exact class of
    disagreement ADR-0089 exists to prevent.
    """
    task = make_task(db, project_id=sample_project.id, title="no status yet", priority="high")
    db.add(task)
    db.commit()
    task.status = None
    db.commit()

    data = client.get("/api/analytics/overview").json()
    assert data["high_priority_active_tasks"] == 1
