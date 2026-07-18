from unittest.mock import AsyncMock

from tests.factories import make_task


def _make_task(db, project_id):
    t = make_task(db, project_id=project_id, title="CI/CD test task", status="todo")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# Patch targets: the router imports functions directly, so we patch in the router module.
_GH = "app.routers.cicd.trigger_github_workflow"
_GL = "app.routers.cicd.trigger_gitlab_pipeline"
_JK = "app.routers.cicd.trigger_jenkins_build"
_GN = "app.routers.cicd.trigger_generic_webhook"


# --- 1. Trigger GitHub workflow ---


def test_trigger_github(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": True, "message": "Workflow deploy.yml triggered on main"})
    monkeypatch.setattr(_GH, mock)

    r = client.post(
        "/api/cicd/trigger/github",
        json={
            "repo": "owner/repo",
            "workflow_id": "deploy.yml",
            "ref": "main",
            "token": "ghp_faketoken",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    mock.assert_called_once_with(
        repo="owner/repo",
        workflow_id="deploy.yml",
        ref="main",
        token="ghp_faketoken",
        inputs=None,
        api_base="https://api.github.com",
    )


# --- 2. Trigger GitLab pipeline ---


def test_trigger_gitlab(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": True, "pipeline_id": 42, "web_url": "https://gitlab.com/pipeline/42"})
    monkeypatch.setattr(_GL, mock)

    r = client.post(
        "/api/cicd/trigger/gitlab",
        json={
            "project_id": "12345",
            "ref": "main",
            "token": "glpat-faketoken",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["pipeline_id"] == 42
    mock.assert_called_once()


# --- 3. Trigger Jenkins build ---


def test_trigger_jenkins(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": True, "message": "Build triggered"})
    monkeypatch.setattr(_JK, mock)

    r = client.post(
        "/api/cicd/trigger/jenkins",
        json={
            "url": "https://jenkins.example.com/job/my-job",
            "token": "jenkins-token",
            "username": "admin",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    mock.assert_called_once_with(
        url="https://jenkins.example.com/job/my-job",
        token="jenkins-token",
        username="admin",
        parameters=None,
    )


# --- 4. Trigger generic webhook ---


def test_trigger_generic(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": True, "status_code": 200, "body": "OK"})
    monkeypatch.setattr(_GN, mock)

    r = client.post(
        "/api/cicd/trigger/generic",
        json={
            "url": "https://webhook.example.com/build",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    mock.assert_called_once_with(
        url="https://webhook.example.com/build",
        method="POST",
        headers=None,
        body=None,
    )


# --- 5. GitHub trigger with task_id logs activity ---


def test_trigger_github_with_task_id(client, db, sample_project, monkeypatch):
    task = _make_task(db, sample_project.id)
    mock = AsyncMock(return_value={"success": True, "message": "Triggered"})
    monkeypatch.setattr(_GH, mock)

    r = client.post(
        "/api/cicd/trigger/github",
        params={"task_id": task.id},
        json={
            "repo": "owner/repo",
            "workflow_id": "ci.yml",
            "ref": "develop",
            "token": "ghp_faketoken",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True

    # Verify activity was logged
    from app.models import ActivityLog

    activity = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.task_id == task.id,
            ActivityLog.action == "cicd.triggered",
        )
        .first()
    )
    assert activity is not None
    assert "GitHub" in activity.detail
    assert activity.project_id == sample_project.id


# --- 6. GitHub trigger failure ---


def test_trigger_github_failure(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": False, "error": "HTTP 401: Bad credentials"})
    monkeypatch.setattr(_GH, mock)

    r = client.post(
        "/api/cicd/trigger/github",
        json={
            "repo": "owner/repo",
            "workflow_id": "deploy.yml",
            "ref": "main",
            "token": "bad-token",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is False
    assert "error" in data


# --- 7. Missing required fields returns 422 ---


def test_trigger_missing_fields(client):
    # GitHub trigger requires repo, workflow_id, and token
    r = client.post(
        "/api/cicd/trigger/github",
        json={
            "repo": "owner/repo",
            # missing workflow_id and token
        },
    )
    assert r.status_code == 422


# --- 8. Generic trigger with custom method ---


def test_trigger_generic_custom_method(client, db, monkeypatch):
    mock = AsyncMock(return_value={"success": True, "status_code": 200, "body": "Updated"})
    monkeypatch.setattr(_GN, mock)

    r = client.post(
        "/api/cicd/trigger/generic",
        json={
            "url": "https://api.example.com/deploy",
            "method": "PUT",
            "headers": {"X-Custom": "value"},
            "body": {"action": "deploy", "version": "1.2.3"},
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    mock.assert_called_once_with(
        url="https://api.example.com/deploy",
        method="PUT",
        headers={"X-Custom": "value"},
        body={"action": "deploy", "version": "1.2.3"},
    )
