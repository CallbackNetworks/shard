"""Tests for app.services.cicd_trigger module."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

import httpx

from app.services.cicd_trigger import (
    trigger_generic_webhook,
    trigger_github_workflow,
    trigger_gitlab_pipeline,
    trigger_jenkins_build,
)


def _mock_response(status_code=200, text="", json_data=None, headers=None):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.text = text
    resp.is_success = 200 <= status_code < 300
    resp.json.return_value = json_data or {}
    resp.headers = headers or {}
    return resp


@pytest.mark.asyncio
async def test_github_workflow_success():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=204)

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_github_workflow("owner/repo", "ci.yml", token="tok")
    assert result["success"] is True
    assert "triggered" in result["message"]


@pytest.mark.asyncio
async def test_github_workflow_failure():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=422, text="Bad request")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_github_workflow("owner/repo", "ci.yml", token="tok")
    assert result["success"] is False
    assert "422" in result["error"]


@pytest.mark.asyncio
async def test_github_workflow_network_error():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.side_effect = httpx.ConnectError("Connection refused")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_github_workflow("owner/repo", "ci.yml", token="tok")
    assert result["success"] is False
    assert "Connection refused" in result["error"]


@pytest.mark.asyncio
async def test_gitlab_pipeline_success():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(
        status_code=201,
        json_data={"id": 123, "web_url": "https://gitlab.com/pipeline/123"},
    )

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_gitlab_pipeline("42", token="glpat-xxx")
    assert result["success"] is True
    assert result["pipeline_id"] == 123


@pytest.mark.asyncio
async def test_gitlab_pipeline_failure():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=403, text="Forbidden")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_gitlab_pipeline("42", token="bad")
    assert result["success"] is False


@pytest.mark.asyncio
async def test_jenkins_build_success():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=201, headers={"location": "/queue/item/5"})

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_jenkins_build("https://jenkins.example.com/job/build", username="admin", token="tok")
    assert result["success"] is True


@pytest.mark.asyncio
async def test_jenkins_build_redirect():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=302, headers={"location": "/queue/item/7"})

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_jenkins_build("https://jenkins.example.com/job/build", token="tok")
    assert result["success"] is True
    assert result["queue_url"] == "/queue/item/7"


@pytest.mark.asyncio
async def test_jenkins_build_with_parameters():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=200)

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_jenkins_build(
            "https://jenkins.example.com/job/build",
            token="tok",
            parameters={"BRANCH": "main"},
        )
    assert result["success"] is True


@pytest.mark.asyncio
async def test_jenkins_build_network_error():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.side_effect = httpx.TimeoutException("Timeout")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_jenkins_build("https://jenkins.example.com/job/x", token="t")
    assert result["success"] is False
    assert "Timeout" in result["error"]


@pytest.mark.asyncio
async def test_generic_webhook_post_success():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=200, text="OK")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_generic_webhook("https://example.com/hook", body={"key": "val"})
    assert result["success"] is True
    assert result["status_code"] == 200


@pytest.mark.asyncio
async def test_generic_webhook_get():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get.return_value = _mock_response(status_code=200, text="pong")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_generic_webhook("https://example.com/ping", method="GET")
    assert result["success"] is True


@pytest.mark.asyncio
async def test_generic_webhook_failure():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post.return_value = _mock_response(status_code=500, text="Internal Server Error")

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await trigger_generic_webhook("https://example.com/hook")
    assert result["success"] is False
    assert result["status_code"] == 500
