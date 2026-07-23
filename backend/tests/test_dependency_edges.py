"""Task dependencies are mirrored as depends_on edges (ADR-0032, phase 2 dual-write)."""

from app.services import graph


def _task(client, pid, title):
    return client.post("/api/nodes", json={"type": "task", "container_id": pid, "title": title}).json()["id"]


def test_dependency_creates_and_removes_edge(client, db, sample_project):
    pid = sample_project.id
    a = _task(client, pid, "A")
    b = _task(client, pid, "B")

    # A depends on B (A blocked by B)
    resp = client.post(f"/api/projects/{pid}/tasks/{a}/dependencies/{b}")
    assert resp.status_code == 201
    prereqs = graph.neighbors(db, a, graph.REL_DEPENDS_ON, direction="out")
    assert [n.id for n in prereqs] == [b]

    resp = client.delete(f"/api/projects/{pid}/tasks/{a}/dependencies/{b}")
    assert resp.status_code == 204
    assert graph.neighbors(db, a, graph.REL_DEPENDS_ON, direction="out") == []
