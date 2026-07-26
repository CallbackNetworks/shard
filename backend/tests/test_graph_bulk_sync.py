"""Bulk operations that bypass the ORM unit of work still keep edges in sync (ADR-0032)."""

from app.models import Edge


def _edge(db, source_id, target_id, rel_type):
    return (
        db.query(Edge)
        .filter(Edge.source_id == source_id, Edge.target_id == target_id, Edge.rel_type == rel_type)
        .first()
    )


def _project(client, name="P"):
    return client.post("/api/nodes", json={"type": "project", "title": name}).json()["id"]


def test_bulk_remove_label_clears_labeled_edge(client, db):
    pid = _project(client)
    tid = client.post("/api/nodes", json={"type": "task", "container_id": pid, "title": "t"}).json()["id"]
    lid = client.post("/api/nodes", json={"type": "label", "container_id": pid, "title": "bug"}).json()["id"]

    # Attach via bulk-update, then confirm the mirror edge exists.
    client.post(f"/api/projects/{pid}/tasks/bulk-update", json={"task_ids": [tid], "add_label_ids": [lid]})
    assert _edge(db, tid, lid, "labeled") is not None

    # Bulk remove goes through query(...).delete() — the fix must still drop the edge.
    client.post(f"/api/projects/{pid}/tasks/bulk-update", json={"task_ids": [tid], "remove_label_ids": [lid]})
    assert _edge(db, tid, lid, "labeled") is None


def test_bulk_update_runs_workflow_rules(client, db):
    """SPA bulk status changes now trigger workflow rules (ADR-0038)."""
    from app.models import ActivityLog, WorkflowRule

    pid = _project(client)
    tid = client.post("/api/nodes", json={"type": "task", "container_id": pid, "title": "bulk rules"}).json()["id"]
    db.add(
        WorkflowRule(
            name="Escalate done tasks",
            trigger="task.status_changed",
            conditions=[{"field": "status", "op": "eq", "value": "done"}],
            actions=[{"type": "set_priority", "value": "high"}],
            active=True,
        )
    )
    db.commit()

    r = client.post(f"/api/projects/{pid}/tasks/bulk-update", json={"task_ids": [tid], "status": "done"})
    assert r.status_code == 200
    task = client.get(f"/api/projects/{pid}").json()
    updated = next(t for t in task["tasks"] if t["id"] == tid)
    assert updated["status"] == "done"
    assert updated["priority"] == "high"
    # Per-task status activity is now recorded alongside the aggregate row.
    actions = [row.action for row in db.query(ActivityLog).all()]
    assert "task.status_changed" in actions
    assert "task.bulk_updated" in actions
