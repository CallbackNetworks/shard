from app.services import graph
from app.services.activity import log_activity


def _url(suffix=""):
    return f"/api/activity-watches{suffix}"


def test_list_watches_empty(client):
    r = client.get(_url())
    assert r.status_code == 200
    assert r.json() == []


def test_create_node_watch(client, sample_project):
    r = client.post(_url(), json={"kind": "node", "target_id": sample_project.id})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "node"
    assert body["target_id"] == sample_project.id
    assert body["label"] == "Test Project"
    assert body["color"]

    r = client.get(_url())
    assert len(r.json()) == 1


def test_create_node_type_watch(client):
    r = client.post(_url(), json={"kind": "node_type", "target_type": "goal"})
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "node_type"
    assert body["target_type"] == "goal"
    assert body["label"]  # resolved from the type registry


def test_create_node_watch_missing_node_404(client):
    r = client.post(_url(), json={"kind": "node", "target_id": "does-not-exist"})
    assert r.status_code == 404


def test_create_node_type_watch_unknown_type_404(client):
    r = client.post(_url(), json={"kind": "node_type", "target_type": "not-a-type"})
    assert r.status_code == 404


def test_create_watch_bad_kind_400(client):
    r = client.post(_url(), json={"kind": "bogus"})
    assert r.status_code == 400


def test_create_node_watch_requires_target_id_400(client):
    r = client.post(_url(), json={"kind": "node"})
    assert r.status_code == 400


def test_colors_rotate_across_watches(client, sample_project):
    r1 = client.post(_url(), json={"kind": "node", "target_id": sample_project.id})
    r2 = client.post(_url(), json={"kind": "node_type", "target_type": "goal"})
    assert r1.json()["color"] != r2.json()["color"]


def test_delete_watch(client, sample_project):
    created = client.post(_url(), json={"kind": "node", "target_id": sample_project.id}).json()
    r = client.delete(_url(f"/{created['id']}"))
    assert r.status_code == 204
    assert client.get(_url()).json() == []


def test_delete_missing_watch_404(client):
    r = client.delete(_url("/does-not-exist"))
    assert r.status_code == 404


def test_activity_entry_reports_node_type_for_task(client, db, sample_project):
    resp = client.post("/api/nodes", json={"type": "task", "container_id": sample_project.id, "title": "Watchable"})
    task_id = resp.json()["id"]

    r = client.get("/api/activity")
    entries = [e for e in r.json() if e["task_id"] == task_id]
    assert entries
    assert entries[0]["node_type"] == "task"


def test_activity_entry_reports_node_type_for_generic_node(client, db):
    goal = graph.create_node(db, "goal", title="A goal")
    db.commit()
    log_activity(
        db,
        "node.created",
        project_id=goal.id,
        detail='goal "A goal" created',
        meta={"type": "goal", "node_id": goal.id},
    )
    db.commit()

    r = client.get("/api/activity")
    entries = [e for e in r.json() if e.get("meta", {}).get("node_id") == goal.id]
    assert entries
    assert entries[0]["node_type"] == "goal"
