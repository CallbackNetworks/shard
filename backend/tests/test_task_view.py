"""TaskView exposes the Task ORM surface from a task node (ADR-0033 B5.2)."""

import hashlib
from datetime import UTC, datetime

from app.models import ApiKey, Comment, Node, Task, TaskPullRequest
from app.services import graph


def _task(db, project_id, **kw):
    t = Task(project_id=project_id, title=kw.pop("title", "T"), **kw)
    db.add(t)
    db.commit()
    return t


def test_get_task_mirrors_all_scalars(db, sample_project):
    t = _task(
        db,
        sample_project.id,
        title="Mirror me",
        description="desc",
        status="in_progress",
        priority="high",
        assignee="me",
        time_estimate=30,
        time_spent=10,
        progress_pct=42,
        agent_notes="notes",
        external_provider="github",
        external_id="99",
        external_url="https://x/1",
        external_repo="o/r",
        due_date=datetime(2026, 8, 1, tzinfo=UTC),
    )

    view = graph.get_task(db, t.id)
    assert view is not None
    assert view.id == t.id
    assert view.title == "Mirror me"
    assert view.description == "desc"
    assert view.status == "in_progress"
    assert view.priority == "high"
    assert view.assignee == "me"
    assert view.callback_token == t.callback_token
    assert view.time_estimate == 30
    assert view.time_spent == 10
    assert view.progress_pct == 42
    assert view.agent_notes == "notes"
    assert view.external_provider == "github"
    assert view.external_id == "99"
    assert view.external_url == "https://x/1"
    assert view.external_repo == "o/r"
    assert view.due_date == t.due_date
    assert view.is_pinned is False
    assert view.position == 0


def test_get_task_rejects_non_task_node(db, sample_project):
    # sample_project.id is a project node, not a task.
    assert graph.get_task(db, sample_project.id) is None
    assert graph.get_task(db, "does-not-exist") is None


def test_task_view_lazy_comments_and_prs(db, sample_project):
    t = _task(db, sample_project.id)
    db.add(Comment(task_id=t.id, project_id=sample_project.id, body="hi", author="a"))
    db.add(
        TaskPullRequest(task_id=t.id, repo="o/r", pr_number="7", pr_url="https://x/pr/7"),
    )
    db.commit()

    view = graph.get_task(db, t.id)
    assert len(view.comments) == 1
    assert view.comments[0].body == "hi"
    assert len(view.pull_requests) == 1
    assert view.pull_requests[0].pr_number == "7"
    assert view.assigned_agent is None


def test_task_view_assigned_agent(db, sample_project):
    raw = "tdp_agent_key_1"
    key = ApiKey(
        name="Agent",
        key=raw,
        key_hash=hashlib.sha256(raw.encode()).hexdigest(),
        key_last4=raw[-4:],
        scopes=["read"],
        active=True,
    )
    db.add(key)
    db.flush()
    t = _task(db, sample_project.id, assigned_agent_key_id=key.id)

    view = graph.get_task(db, t.id)
    assert view.assigned_agent is not None
    assert view.assigned_agent.name == "Agent"


def test_task_views_by_ids_and_order(db, sample_project):
    a = _task(db, sample_project.id, title="A")
    b = _task(db, sample_project.id, title="B")

    by_id = graph.task_views_by_ids(db, [a.id, b.id])
    assert set(by_id) == {a.id, b.id}
    assert by_id[a.id].title == "A"

    ordered = graph.task_views_for_ids(db, [b.id, a.id, "missing"])
    assert [v.title for v in ordered] == ["B", "A"]


def test_task_view_matches_task_out(db, sample_project):
    """enrich_task works identically whether fed a Task or a TaskView."""
    from app.services.enrichment import enrich_task

    t = _task(db, sample_project.id, title="Same", description="d", status="done")
    db.add(Comment(task_id=t.id, project_id=sample_project.id, body="c", author="a"))
    db.commit()

    from_orm = enrich_task(db.get(Task, t.id), db)
    from_view = enrich_task(graph.get_task(db, t.id), db)
    # Core fields identical regardless of source object.
    for field in ("id", "title", "description", "status", "comment_count", "project_id"):
        assert getattr(from_orm, field) == getattr(from_view, field)


def test_node_helper_ignores_task_view_for_project(db, sample_project):
    # A project node must not be returned by get_task even though it exists.
    assert db.get(Node, sample_project.id).type == "project"
    assert graph.get_task(db, sample_project.id) is None
