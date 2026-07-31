from tests.factories import make_task


def _make_task(db, project_id, title="Test Task", status="todo"):
    task = make_task(db, project_id=project_id, title=title, status=status)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_valid_callback_updates_status(client, db, sample_project):
    task = _make_task(db, sample_project.id)
    resp = client.post(
        f"/webhook/callback/{task.callback_token}",
        json={"status": "done"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "done"
    assert data["id"] == task.id
    # The response is enriched: containment compat fields come from edges (ADR-0032).
    assert data["project_id"] == sample_project.id
    assert data["project_ids"] == [sample_project.id]


def test_invalid_callback_token_returns_404(client):
    resp = client.post(
        "/webhook/callback/nonexistent-token",
        json={"status": "done"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Invalid callback token"


def test_status_transition(client, db, sample_project):
    task = _make_task(db, sample_project.id)

    resp = client.post(
        f"/webhook/callback/{task.callback_token}",
        json={"status": "in_progress"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"

    resp = client.post(
        f"/webhook/callback/{task.callback_token}",
        json={"status": "done"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


def test_all_tasks_done_triggers_project_complete(client, db, sample_project):
    task1 = _make_task(db, sample_project.id, title="Task 1")
    task2 = _make_task(db, sample_project.id, title="Task 2")

    resp1 = client.post(
        f"/webhook/callback/{task1.callback_token}",
        json={"status": "done"},
    )
    assert resp1.status_code == 200

    resp2 = client.post(
        f"/webhook/callback/{task2.callback_token}",
        json={"status": "done"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "done"

    # Verify both tasks are actually done in the DB
    db.refresh(task1)
    db.refresh(task2)
    assert task1.status == "done"
    assert task2.status == "done"


def test_message_field_is_optional(client, db, sample_project):
    task = _make_task(db, sample_project.id)

    # Without message
    resp = client.post(
        f"/webhook/callback/{task.callback_token}",
        json={"status": "in_progress"},
    )
    assert resp.status_code == 200

    # With message
    task2 = _make_task(db, sample_project.id, title="Task 2")
    resp = client.post(
        f"/webhook/callback/{task2.callback_token}",
        json={"status": "done", "message": "Build passed"},
    )
    assert resp.status_code == 200


def test_callback_fires_status_changed_event(client, db, sample_project, monkeypatch):
    """Webhook callbacks now emit task.status_changed alongside task.{status} (ADR-0038)."""
    from app.services import task_mutations

    events = []

    async def fake_notify(db_, task, event, **kwargs):
        events.append(event)

    monkeypatch.setattr(task_mutations, "fire_notifications", fake_notify)
    task = _make_task(db, sample_project.id)
    resp = client.post(f"/webhook/callback/{task.callback_token}", json={"status": "done"})
    assert resp.status_code == 200
    assert "task.status_changed" in events
    assert "task.done" in events
    assert "project.complete" in events


class TestUnrecognisedCallback:
    """A callback this system cannot read must never invent an outcome (ADR-0051)."""

    def _post(self, client, task, payload):
        return client.post(f"/webhook/callback/{task.callback_token}", json=payload)

    def test_unknown_status_leaves_the_task_alone(self, client, db, sample_project):
        task = _make_task(db, sample_project.id, status="in_progress")
        resp = self._post(client, task, {"status": "sucess"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "in_progress"
        db.refresh(task)
        assert task.status == "in_progress"

    def test_unknown_status_is_recorded_in_the_activity_feed(self, client, db, sample_project):
        from app.models import ActivityLog

        task = _make_task(db, sample_project.id)
        self._post(client, task, {"status": "timed_out"})

        row = db.query(ActivityLog).filter(ActivityLog.action == "webhook.unmapped_status").one()
        # Scoped to the project, or the project activity page would never show it.
        assert row.project_id == sample_project.id
        assert row.task_id == task.id
        assert row.meta["raw_status"] == "timed_out"

    def test_unknown_status_still_lands_in_build_history(self, client, db, sample_project):
        from app.models import WebhookEvent

        task = _make_task(db, sample_project.id)
        self._post(client, task, {"status": "whatever"})

        event = db.query(WebhookEvent).filter(WebhookEvent.task_id == task.id).one()
        assert event.status == "unmapped"

    def test_empty_body_leaves_the_task_alone(self, client, db, sample_project):
        task = _make_task(db, sample_project.id, status="todo")
        resp = self._post(client, task, {})
        assert resp.status_code == 200
        assert resp.json()["status"] == "todo"

    def test_unknown_provider_hint_is_rejected(self, client, db, sample_project):
        task = _make_task(db, sample_project.id)
        resp = client.post(
            f"/webhook/callback/{task.callback_token}?provider=githbu",
            json={"status": "done"},
        )
        assert resp.status_code == 422
        assert "githbu" in resp.json()["detail"]
        db.refresh(task)
        assert task.status == "todo"

    def test_known_provider_hint_still_works(self, client, db, sample_project):
        task = _make_task(db, sample_project.id)
        resp = client.post(
            f"/webhook/callback/{task.callback_token}?provider=github",
            json={"action": "completed", "workflow_run": {"conclusion": "success"}},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"


def test_callback_same_status_logs_no_activity(client, db, sample_project):
    """A no-op status callback no longer records a bogus status_changed row."""
    from app.models import ActivityLog

    task = _make_task(db, sample_project.id, status="done")
    resp = client.post(f"/webhook/callback/{task.callback_token}", json={"status": "done"})
    assert resp.status_code == 200
    rows = db.query(ActivityLog).filter(ActivityLog.action == "task.status_changed").count()
    assert rows == 0
