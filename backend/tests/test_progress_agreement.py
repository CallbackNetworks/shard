"""One project, one set of numbers, on every surface that reports them (ADR-0065).

The rollup rule was fixed for the project page first; the other readers each carried
their own copy scoped to *direct* children, so a project with a nested container
reported one size in the app and a smaller one in a share link, a search hit, the
external API, a notification and the daily summary. This file pins the agreement:
build one project whose work is split across a nested container, then ask every
surface how big it is.
"""

import hashlib

import pytest

from app.models import ApiKey
from app.services import graph
from tests.factories import make_project, make_task

# 4 top-level tasks in total: 2 held directly, 2 inside a nested container — plus one
# subtask, which is part of its parent's unit of work and must not change any size.
DIRECT_TASKS = [("held here", "done"), ("also here", "todo")]
NESTED_TASKS = [("one level down", "done"), ("also down", "in_progress")]
EXPECTED_TOTAL = 4
EXPECTED_DONE = 2


@pytest.fixture()
def read_key(db):
    raw = "tdp_progress_agreement_key"
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
def nested_project(client, db, sample_identity):
    """A project whose work is split between itself and a container one level down."""
    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "roles": ["container"]})
    project = make_project(db, name="Split work")
    first = None
    for title, status in DIRECT_TASKS:
        task = make_task(db, project_id=project.id, title=title, status=status)
        first = first or task
    # A subtask: one unit of work with its parent, so it must not change any size —
    # the other half of the disagreement (some surfaces used to count subtasks).
    make_task(db, project_id=project.id, parent_id=first.id, title="a subtask", status="done")
    db.commit()
    area = client.post("/api/nodes", json={"type": "area", "title": "Nested area"}).json()
    client.post(f"/api/nodes/{project.id}/edges", json={"target_id": area["id"], "rel_type": "contains"})
    for title, status in NESTED_TASKS:
        client.post("/api/nodes", json={"type": "task", "title": title, "status": status, "container_id": area["id"]})
    client.post(
        f"/api/nodes/{sample_identity.id}/edges",
        json={"target_id": project.id, "rel_type": "member_of"},
    )
    db.commit()
    return project


def test_subtask_does_not_change_the_size(client, db, nested_project):
    """The fixture holds a done subtask; no surface may count it as a fifth task."""
    assert len(graph.subtree_task_ids(db, nested_project.id)) == EXPECTED_TOTAL + 1
    assert len(graph.subtree_task_ids(db, nested_project.id, top_level_only=True)) == EXPECTED_TOTAL


def test_project_page_counts_the_whole_subtree(client, nested_project):
    body = client.get(f"/api/projects/{nested_project.id}").json()
    assert (body["total_tasks"], body["done_tasks"]) == (EXPECTED_TOTAL, EXPECTED_DONE)


def test_internal_search_agrees(client, nested_project):
    body = client.get("/api/search", params={"q": "Split work"}).json()
    hit = next(p for p in body["projects"] if p["id"] == nested_project.id)
    assert hit["total_tasks"] == EXPECTED_TOTAL
    assert hit["done_tasks"] == EXPECTED_DONE


def test_public_share_page_agrees(client, db, nested_project):
    token = graph.get_project(db, nested_project.id).share_token
    body = client.get(f"/share/node/{token}").json()
    project = next(p for p in body["projects"] if p["id"] == nested_project.id)
    assert (project["total_tasks"], project["done_tasks"]) == (EXPECTED_TOTAL, EXPECTED_DONE)
    # The share page's own header sums the projects it shows, so it agrees too.
    assert body["summary"]["total_tasks"] == EXPECTED_TOTAL
    assert body["summary"]["done_tasks"] == EXPECTED_DONE


def test_external_api_project_read_agrees(client, nested_project, read_key):
    body = client.get(f"/api/v1/projects/{nested_project.id}", headers=read_key).json()
    assert body["total_tasks"] == EXPECTED_TOTAL
    assert body["done_tasks"] == EXPECTED_DONE


def test_external_api_stats_agrees(client, nested_project, read_key):
    body = client.get(f"/api/v1/projects/{nested_project.id}/stats", headers=read_key).json()
    assert body["total_tasks"] == EXPECTED_TOTAL
    assert body["done_tasks"] == EXPECTED_DONE
    # The breakdown is drawn from the same task set, so it adds up to the total.
    assert sum(body["by_status"].values()) == EXPECTED_TOTAL


def test_external_api_search_agrees(client, nested_project, read_key):
    body = client.get("/api/v1/search", params={"q": "Split work"}, headers=read_key).json()
    hit = next(p for p in body["projects"] if p["id"] == nested_project.id)
    assert hit["total_tasks"] == EXPECTED_TOTAL


def test_external_api_summary_agrees(client, nested_project, read_key):
    body = client.get("/api/v1/summary", headers=read_key).json()
    hit = next(p for p in body["projects"] if p["id"] == nested_project.id)
    assert hit["total_tasks"] == EXPECTED_TOTAL
    assert hit["done"] == EXPECTED_DONE


def test_identity_hub_stats_agree(client, nested_project, sample_identity):
    body = client.get("/api/identities/hub-stats").json()
    identity = next(i for i in body["identities"] if i["id"] == sample_identity.id)
    project = next(p for p in identity["projects"] if p["id"] == nested_project.id)
    assert project["total_tasks"] == EXPECTED_TOTAL
    assert project["done"] == EXPECTED_DONE


def test_notification_payload_agrees(db, nested_project):
    from app.services.notifier import _compute_progress

    project = graph.get_project(db, nested_project.id)
    total, done, _progress = _compute_progress(project, db)
    assert (total, done) == (EXPECTED_TOTAL, EXPECTED_DONE)


@pytest.mark.anyio
async def test_assistant_summary_agrees(db, nested_project):
    import json

    from app.services.assistant_tools import _tool_get_summary

    result = json.loads(await _tool_get_summary(db))
    project = next(p for p in result if p["id"] == nested_project.id)
    assert project["total"] == EXPECTED_TOTAL
    assert project["done"] == EXPECTED_DONE


def test_v1_exposes_the_subtree(client, db, nested_project, read_key):
    """External clients (MCP included) can see the level below, not just the tasks."""
    body = client.get(f"/api/v1/nodes/{nested_project.id}/subtree", headers=read_key).json()
    assert body["total_tasks"] == EXPECTED_TOTAL
    assert body["direct_task_count"] == len(DIRECT_TASKS)
    assert [c["title"] for c in body["children"]] == ["Nested area"]
    assert body["children"][0]["total_tasks"] == len(NESTED_TASKS)


def test_v1_subtree_needs_a_key(client, nested_project):
    assert client.get(f"/api/v1/nodes/{nested_project.id}/subtree").status_code in (401, 403, 422)


def test_v1_subtree_hides_containers_outside_a_scoped_key(client, db, nested_project):
    """A project-scoped key must not learn the titles of containers it cannot read."""
    other = make_project(db, name="Someone else's project")
    raw = "tdp_scoped_agreement_key"
    db.add(
        ApiKey(
            name="Scoped",
            key=raw,
            key_hash=hashlib.sha256(raw.encode()).hexdigest(),
            key_last4=raw[-4:],
            scopes=["read"],
            active=True,
            project_id=other.id,
        )
    )
    db.commit()
    client.post("/api/graph-types/nodes", json={"key": "area", "label": "Area", "roles": ["container"]})
    outsider = client.post("/api/nodes", json={"type": "area", "title": "Secret area"}).json()
    client.post(f"/api/nodes/{other.id}/edges", json={"target_id": outsider["id"], "rel_type": "contains"})

    body = client.get(f"/api/v1/nodes/{other.id}/subtree", headers={"X-API-Key": raw}).json()
    # Its own container is visible; nothing from the other project leaks in.
    assert [c["title"] for c in body["children"]] == ["Secret area"]
    assert client.get(f"/api/v1/nodes/{nested_project.id}/subtree", headers={"X-API-Key": raw}).status_code == 403
