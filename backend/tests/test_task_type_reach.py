"""A task-like custom type is a task everywhere, not only where someone remembered.

``node_types`` lets a user declare a type that plays the ``task`` role, and such a
node is a first-class task (ADR-0033, ADR-0035): the ``graph`` service layer asks
``task_type_keys(db)`` throughout. Its *callers* did not. Twenty-eight queries
across the schedulers, the analytics, the search and the external API compared
``Node.type == NODE_TASK`` — the literal built-in — so a custom type was silently
absent from each of them (ADR-0089).

That is not a cosmetic gap. Live, on the development database:

* the analytics page counted 81 overdue where the dashboard counted 83;
* a project search hit reported 2 tasks done where the project page reported 3,
  which ADR-0068 exists specifically to prevent;
* no due-date reminder, daily summary, weekly digest or SLA escalation could
  ever mention one.

`graph.task_type_filter(db)` is the criterion. This file fails on a new literal
comparison rather than waiting for someone to notice a number that is too small.
"""

import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent / "app"

# A *query* comparing the type column against the built-in key. Creation sites
# (``ensure_node(db, id, graph.NODE_TASK)``) are a different thing: they mean
# "make one of the built-in kind", which is exactly right.
LITERAL_TYPE_QUERY = re.compile(r"Node\.type\s*==\s*(?:graph\.)?NODE_TASK")

# Where the rule itself is written down, and so the only place allowed to name
# the literal in this shape.
ALLOWED = {"services/graph/core.py"}


def _python_sources():
    return sorted(p for p in APP.rglob("*.py") if "__pycache__" not in p.parts)


@pytest.mark.parametrize("path", _python_sources(), ids=lambda p: str(p.relative_to(APP)))
def test_no_query_matches_the_literal_task_type(path):
    rel = str(path.relative_to(APP))
    if rel in ALLOWED:
        return
    offenders = [
        f"{rel}:{i}" for i, line in enumerate(path.read_text().splitlines(), 1) if LITERAL_TYPE_QUERY.search(line)
    ]
    assert not offenders, (
        f"{offenders} compares Node.type against the built-in task key, so a custom "
        f"type playing the task role is excluded — use graph.task_type_filter(db)"
    )


def test_the_filter_covers_the_built_in_and_a_custom_role_holder(client, db):
    """The filter is registry-driven: declaring the role is what makes a task."""
    from app.services import graph

    assert graph.NODE_TASK in graph.task_type_keys(db)

    client.post("/api/graph-types/nodes", json={"key": "incident", "label": "Incident", "roles": ["task"]})
    assert "incident" in graph.task_type_keys(db)

    # A type with no task role stays out of it.
    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "roles": ["container"]})
    assert "area" not in graph.task_type_keys(db)


def test_a_search_hit_reports_what_the_project_page_reports(client, db, sample_identity):
    """ADR-0068's rule, with a custom type in the project.

    ``subtree_task_ids`` counted the incident and the done-count beside it did
    not, so search said one fewer task was finished than the project page did.
    """
    from tests.factories import make_project, make_task

    project = make_project(db, name="Mixed types")
    make_task(db, project_id=project.id, title="a built-in task", status="done")
    db.commit()

    client.post("/api/graph-types/nodes", json={"key": "incident", "label": "Incident", "roles": ["task"]})
    client.post(
        "/api/nodes",
        json={"type": "incident", "title": "an incident", "status": "done", "container_id": project.id},
    )
    db.commit()

    page = client.get(f"/api/projects/{project.id}").json()
    hit = next(
        p
        for p in client.get("/api/search", params={"q": "Mixed types"}).json()["projects"]
        if p["id"] == str(project.id)
    )

    assert (page["total_tasks"], page["done_tasks"]) == (2, 2)
    assert (hit["total_tasks"], hit["done_tasks"]) == (page["total_tasks"], page["done_tasks"])


def test_a_custom_type_reaches_the_due_date_reminder(client, db, sample_identity):
    """The scheduler's reminder sweep is the surface with no other way to notice."""
    from datetime import UTC, datetime, timedelta

    from app.models import Node
    from app.services import graph
    from tests.factories import make_project

    project = make_project(db, name="Reminders")
    db.commit()
    client.post("/api/graph-types/nodes", json={"key": "incident", "label": "Incident", "roles": ["task"]})
    soon = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    created = client.post(
        "/api/nodes",
        json={
            "type": "incident",
            "title": "incident due soon",
            "status": "todo",
            "due_date": soon,
            "container_id": project.id,
        },
    ).json()
    db.commit()

    cutoff = datetime.now(UTC) + timedelta(hours=24)
    candidates = (
        db.query(Node)
        .filter(
            graph.task_type_filter(db),
            Node.due_date != None,  # noqa: E711 — SQLAlchemy needs the operator form
            graph.open_status_clause(),  # the sweep's own criterion, NULL included (ADR-0142)
            Node.due_date <= cutoff,
        )
        .all()
    )
    assert created["id"] in {n.id for n in candidates}
