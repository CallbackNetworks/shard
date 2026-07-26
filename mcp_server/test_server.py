"""Tests for MCP server tool implementations, resources, and prompts.

All HTTP calls are mocked via httpx — no backend required.
"""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import pytest_asyncio

import server as mcp_server


# ── Helpers ─────────────────────────────────────────────────────────


def _mock_response(status_code=200, json_data=None, text=""):
    """Create a mock httpx.Response."""
    resp = AsyncMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.text = text or json.dumps(json_data or {})
    resp.json = lambda: json_data if json_data is not None else {}
    return resp


def _patch_client(method, response):
    """Patch httpx.AsyncClient to return a mock response for the given HTTP method."""
    client = AsyncMock()
    getattr(client, method).return_value = response
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("server.httpx.AsyncClient", return_value=client)


async def _call(tool_name, arguments=None):
    """Call a tool and return the text result."""
    result = await mcp_server.call_tool(tool_name, arguments)
    assert len(result) == 1
    return result[0].text


# ── Tool: get_summary ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_summary():
    data = {"total_projects": 3, "active_projects": 2, "total_tasks": 15}
    with _patch_client("get", _mock_response(json_data=data)):
        text = await _call("get_summary")
    parsed = json.loads(text)
    assert parsed["total_projects"] == 3


@pytest.mark.asyncio
async def test_get_summary_error():
    with _patch_client("get", _mock_response(status_code=500, text="Internal Server Error")):
        text = await _call("get_summary")
    assert "Error 500" in text


# ── Tool: list_tasks ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_tasks():
    tasks = [{"id": "t1", "title": "Task 1"}, {"id": "t2", "title": "Task 2"}]
    with _patch_client("get", _mock_response(json_data=tasks)):
        text = await _call("list_tasks", {"project_id": "p1"})
    parsed = json.loads(text)
    assert len(parsed) == 2


@pytest.mark.asyncio
async def test_list_tasks_with_filters():
    tasks = [{"id": "t1", "title": "Done task", "status": "done"}]
    with _patch_client("get", _mock_response(json_data=tasks)) as mock_cls:
        text = await _call("list_tasks", {"project_id": "p1", "status": "done", "priority": "high"})
        client = mock_cls.return_value
        call_args = client.get.call_args
        assert call_args[1]["params"]["status_filter"] == "done"
        assert call_args[1]["params"]["priority"] == "high"


# ── Tool: create_task ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_task():
    created = {"id": "t3", "title": "New task", "priority": "high"}
    with _patch_client("post", _mock_response(json_data=created)) as mock_cls:
        text = await _call("create_task", {
            "project_id": "p1", "title": "New task", "priority": "high",
            "description": "Some desc", "assignee": "alice", "due_date": "2026-07-01"
        })
        client = mock_cls.return_value
        body = client.post.call_args[1]["json"]
        assert body["title"] == "New task"
        assert body["assignee"] == "alice"
        assert body["due_date"] == "2026-07-01"
    parsed = json.loads(text)
    assert parsed["id"] == "t3"


@pytest.mark.asyncio
async def test_create_task_minimal():
    created = {"id": "t4", "title": "Minimal", "priority": "medium"}
    with _patch_client("post", _mock_response(json_data=created)):
        text = await _call("create_task", {"project_id": "p1", "title": "Minimal"})
    parsed = json.loads(text)
    assert parsed["title"] == "Minimal"


# ── Tool: update_task ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_task():
    updated = {"id": "t1", "status": "done"}
    with _patch_client("patch", _mock_response(json_data=updated)) as mock_cls:
        text = await _call("update_task", {"project_id": "p1", "task_id": "t1", "status": "done"})
        client = mock_cls.return_value
        body = client.patch.call_args[1]["json"]
        assert body["status"] == "done"
    parsed = json.loads(text)
    assert parsed["status"] == "done"


@pytest.mark.asyncio
async def test_update_task_no_fields():
    text = await _call("update_task", {"project_id": "p1", "task_id": "t1"})
    assert "No fields to update" in text


# ── Tool: create_subtask ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_subtask():
    sub = {"id": "t5", "title": "Sub", "parent_id": "t1"}
    with _patch_client("post", _mock_response(json_data=sub)) as mock_cls:
        text = await _call("create_subtask", {
            "project_id": "p1", "parent_task_id": "t1", "title": "Sub"
        })
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert body["parent_id"] == "t1"
    parsed = json.loads(text)
    assert parsed["parent_id"] == "t1"


# ── Tool: manage_labels ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_manage_labels_list():
    labels = [{"id": "l1", "name": "bug"}]
    with _patch_client("get", _mock_response(json_data=labels)):
        text = await _call("manage_labels", {"action": "list", "project_id": "p1"})
    parsed = json.loads(text)
    assert parsed[0]["name"] == "bug"


@pytest.mark.asyncio
async def test_manage_labels_list_no_project():
    text = await _call("manage_labels", {"action": "list"})
    assert "project_id required" in text


@pytest.mark.asyncio
async def test_manage_labels_add():
    with _patch_client("post", _mock_response(json_data={"status": "ok"})):
        text = await _call("manage_labels", {
            "action": "add", "project_id": "p1", "task_id": "t1", "label_id": "l1"
        })
    parsed = json.loads(text)
    assert parsed["status"] == "ok"


@pytest.mark.asyncio
async def test_manage_labels_add_missing_params():
    text = await _call("manage_labels", {"action": "add", "project_id": "p1"})
    assert "required" in text


@pytest.mark.asyncio
async def test_manage_labels_remove():
    with _patch_client("delete", _mock_response(status_code=204)):
        text = await _call("manage_labels", {
            "action": "remove", "project_id": "p1", "task_id": "t1", "label_id": "l1"
        })
    parsed = json.loads(text)
    assert parsed["status"] == "deleted"


@pytest.mark.asyncio
async def test_manage_labels_unknown_action():
    text = await _call("manage_labels", {"action": "rename", "project_id": "p1"})
    assert "Unknown label action" in text


# ── Tool: analyze_workload ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_analyze_workload_with_project():
    stats = {"total": 10, "done": 5}
    with _patch_client("get", _mock_response(json_data=stats)) as mock_cls:
        text = await _call("analyze_workload", {"project_id": "p1"})
        url = mock_cls.return_value.get.call_args[0][0]
        assert "/projects/p1/stats" in url


@pytest.mark.asyncio
async def test_analyze_workload_overview():
    overview = {"total_tasks": 50}
    with _patch_client("get", _mock_response(json_data=overview)) as mock_cls:
        text = await _call("analyze_workload", {})
        url = mock_cls.return_value.get.call_args[0][0]
        assert "/analytics/overview" in url


# ── Tool: search ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search():
    results = {"tasks": [{"id": "t1"}], "projects": []}
    with _patch_client("get", _mock_response(json_data=results)) as mock_cls:
        text = await _call("search", {"query": "deploy"})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["q"] == "deploy"


# ── Tool: get_activity ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_activity():
    activities = [{"id": "a1", "action": "task.created"}]
    with _patch_client("get", _mock_response(json_data=activities)) as mock_cls:
        text = await _call("get_activity", {"limit": 5})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["limit"] == 5


# ── Tool: add_comment ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_comment():
    comment = {"id": "c1", "body": "Nice work"}
    with _patch_client("post", _mock_response(json_data=comment)) as mock_cls:
        text = await _call("add_comment", {
            "project_id": "p1", "task_id": "t1", "body": "Nice work", "author": "bob"
        })
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert body["body"] == "Nice work"
        assert body["author"] == "bob"


@pytest.mark.asyncio
async def test_add_comment_no_author():
    comment = {"id": "c2", "body": "Hello"}
    with _patch_client("post", _mock_response(json_data=comment)) as mock_cls:
        await _call("add_comment", {"project_id": "p1", "task_id": "t1", "body": "Hello"})
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert "author" not in body


# ── Tool: list_comments ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_comments():
    comments = [{"id": "c1"}, {"id": "c2"}]
    with _patch_client("get", _mock_response(json_data=comments)):
        text = await _call("list_comments", {"project_id": "p1", "task_id": "t1"})
    parsed = json.loads(text)
    assert len(parsed) == 2


# ── Tool: manage_dependencies ───────────────────────────────────────


@pytest.mark.asyncio
async def test_manage_dependencies_list():
    deps = {"blocked_by": ["t2"], "blocking": []}
    with _patch_client("get", _mock_response(json_data=deps)):
        text = await _call("manage_dependencies", {
            "action": "list", "project_id": "p1", "task_id": "t1"
        })
    parsed = json.loads(text)
    assert "blocked_by" in parsed


@pytest.mark.asyncio
async def test_manage_dependencies_add():
    with _patch_client("post", _mock_response(json_data={"status": "ok"})):
        text = await _call("manage_dependencies", {
            "action": "add", "project_id": "p1", "task_id": "t1", "depends_on_id": "t2"
        })
    parsed = json.loads(text)
    assert parsed["status"] == "ok"


@pytest.mark.asyncio
async def test_manage_dependencies_add_missing_id():
    text = await _call("manage_dependencies", {
        "action": "add", "project_id": "p1", "task_id": "t1"
    })
    assert "depends_on_id required" in text


@pytest.mark.asyncio
async def test_manage_dependencies_remove():
    with _patch_client("delete", _mock_response(status_code=204)):
        text = await _call("manage_dependencies", {
            "action": "remove", "project_id": "p1", "task_id": "t1", "depends_on_id": "t2"
        })
    parsed = json.loads(text)
    assert parsed["status"] == "deleted"


@pytest.mark.asyncio
async def test_manage_dependencies_unknown_action():
    text = await _call("manage_dependencies", {
        "action": "reorder", "project_id": "p1", "task_id": "t1"
    })
    assert "Unknown dependency action" in text


# ── Tool: get_notifications ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_notifications():
    notifs = [{"id": "n1", "type": "task.done"}]
    with _patch_client("get", _mock_response(json_data=notifs)) as mock_cls:
        text = await _call("get_notifications", {"unread_only": False, "limit": 10})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["unread_only"] == "false"
        assert params["limit"] == 10


# ── Tool: get_agent_context ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_agent_context():
    ctx = {"capabilities": ["tasks", "projects"], "instructions": "Be helpful"}
    with _patch_client("get", _mock_response(json_data=ctx)):
        text = await _call("get_agent_context")
    parsed = json.loads(text)
    assert "capabilities" in parsed


# ── Tool: report_progress ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_report_progress():
    result = {"status": "ok"}
    with _patch_client("post", _mock_response(json_data=result)) as mock_cls:
        text = await _call("report_progress", {
            "project_id": "p1", "task_id": "t1",
            "progress_pct": 75, "agent_notes": "Almost done", "comment": "Update"
        })
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert body["progress_pct"] == 75
        assert body["agent_notes"] == "Almost done"
        assert body["comment"] == "Update"


@pytest.mark.asyncio
async def test_report_progress_partial():
    result = {"status": "ok"}
    with _patch_client("post", _mock_response(json_data=result)) as mock_cls:
        await _call("report_progress", {"project_id": "p1", "task_id": "t1", "progress_pct": 50})
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert body["progress_pct"] == 50
        assert "agent_notes" not in body


# ── Tool: list_projects (new) ──────────────────────────────────────


@pytest.mark.asyncio
async def test_list_projects():
    projects = [{"id": "p1", "name": "Alpha"}, {"id": "p2", "name": "Beta"}]
    with _patch_client("get", _mock_response(json_data=projects)):
        text = await _call("list_projects", {})
    parsed = json.loads(text)
    assert len(parsed) == 2


@pytest.mark.asyncio
async def test_list_projects_with_status():
    projects = [{"id": "p1", "name": "Alpha", "status": "active"}]
    with _patch_client("get", _mock_response(json_data=projects)) as mock_cls:
        text = await _call("list_projects", {"status": "active"})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["status"] == "active"


# ── Tool: create_project (new) ─────────────────────────────────────


@pytest.mark.asyncio
async def test_create_project():
    project = {"id": "p3", "name": "Gamma", "description": "New project"}
    with _patch_client("post", _mock_response(json_data=project)) as mock_cls:
        text = await _call("create_project", {"name": "Gamma", "description": "New project"})
        body = mock_cls.return_value.post.call_args[1]["json"]
        # ADR-0042: create_project goes through the node surface (type/title/data).
        assert body["type"] == "project"
        assert body["title"] == "Gamma"
        assert body["data"]["description"] == "New project"
    parsed = json.loads(text)
    assert parsed["name"] == "Gamma"


@pytest.mark.asyncio
async def test_create_project_minimal():
    project = {"id": "p4", "name": "Delta"}
    with _patch_client("post", _mock_response(json_data=project)) as mock_cls:
        text = await _call("create_project", {"name": "Delta"})
        body = mock_cls.return_value.post.call_args[1]["json"]
        assert body["title"] == "Delta"
        assert "data" not in body


# ── Tool: delete_task (new) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_task():
    with _patch_client("delete", _mock_response(status_code=204)) as mock_cls:
        text = await _call("delete_task", {"project_id": "p1", "task_id": "t1"})
        url = mock_cls.return_value.delete.call_args[0][0]
        assert "/nodes/t1" in url
    parsed = json.loads(text)
    assert parsed["status"] == "deleted"


@pytest.mark.asyncio
async def test_delete_task_not_found():
    with _patch_client("delete", _mock_response(status_code=404, text="Not found")):
        text = await _call("delete_task", {"project_id": "p1", "task_id": "t999"})
    assert "Error 404" in text


# ── Unknown tool ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unknown_tool():
    text = await _call("nonexistent_tool", {})
    assert "Unknown tool" in text


# ── Tool error handling ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tool_exception_handling():
    with patch("server._get_summary", side_effect=Exception("connection refused")):
        text = await _call("get_summary")
    assert "Tool error" in text


# ── HTTP helper: _post 204 ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_204_returns_ok():
    with _patch_client("post", _mock_response(status_code=204)):
        result = await mcp_server._post("/some/path")
    assert result == {"status": "ok"}


# ── HTTP helper: _delete 204 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_204_returns_deleted():
    with _patch_client("delete", _mock_response(status_code=204)):
        result = await mcp_server._delete("/some/path")
    assert result == {"status": "deleted"}


# ── HTTP helper: error responses ────────────────────────────────────


@pytest.mark.asyncio
async def test_get_error_response():
    with _patch_client("get", _mock_response(status_code=403, text="Forbidden")):
        result = await mcp_server._get("/locked")
    assert result == "Error 403: Forbidden"


@pytest.mark.asyncio
async def test_patch_error_response():
    with _patch_client("patch", _mock_response(status_code=422, text="Validation error")):
        result = await mcp_server._patch("/bad", {"bad": "data"})
    assert result == "Error 422: Validation error"


# ── MCP registry: list_tools ────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_tools_count():
    tools = await mcp_server.list_tools()
    assert len(tools) == 18  # 15 original + 3 new


@pytest.mark.asyncio
async def test_list_tools_names():
    tools = await mcp_server.list_tools()
    names = {t.name for t in tools}
    expected = {
        "get_summary", "list_tasks", "create_task", "update_task", "create_subtask",
        "manage_labels", "analyze_workload", "search", "get_activity",
        "add_comment", "list_comments", "manage_dependencies", "get_notifications",
        "get_agent_context", "report_progress",
        "list_projects", "create_project", "delete_task",
    }
    assert names == expected


# ── MCP registry: list_resources ────────────────────────────────────


@pytest.mark.asyncio
async def test_list_resources():
    resources = await mcp_server.list_resources()
    assert len(resources) == 4
    uris = {str(r.uri) for r in resources}
    assert "todo://summary" in uris
    assert "todo://activity" in uris
    assert "todo://notifications" in uris
    assert "todo://agent-context" in uris


# ── MCP registry: list_resource_templates ───────────────────────────


@pytest.mark.asyncio
async def test_list_resource_templates():
    templates = await mcp_server.list_resource_templates()
    assert len(templates) == 1
    assert "project_id" in templates[0].uriTemplate


# ── MCP: read_resource ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_read_resource_summary():
    data = {"total_projects": 2}
    with _patch_client("get", _mock_response(json_data=data)):
        result = await mcp_server.read_resource("todo://summary")
    assert len(result) == 1
    parsed = json.loads(result[0].text)
    assert parsed["total_projects"] == 2


@pytest.mark.asyncio
async def test_read_resource_project():
    data = {"id": "p1", "name": "Test", "tasks": []}
    with _patch_client("get", _mock_response(json_data=data)):
        result = await mcp_server.read_resource("todo://projects/p1")
    parsed = json.loads(result[0].text)
    assert parsed["id"] == "p1"


@pytest.mark.asyncio
async def test_read_resource_unknown():
    result = await mcp_server.read_resource("todo://nope")
    parsed = json.loads(result[0].text)
    assert "error" in parsed


# ── MCP: list_prompts ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_prompts():
    prompts = await mcp_server.list_prompts()
    assert len(prompts) == 4
    names = {p.name for p in prompts}
    assert names == {"plan-my-day", "project-review", "triage-inbox", "weekly-summary"}


# ── MCP: get_prompt ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_prompt_plan_my_day():
    result = await mcp_server.get_prompt("plan-my-day")
    assert len(result.messages) == 1
    assert "overdue" in result.messages[0].content.text.lower()


@pytest.mark.asyncio
async def test_get_prompt_project_review():
    result = await mcp_server.get_prompt("project-review", {"project_name": "Alpha"})
    assert "Alpha" in result.messages[0].content.text


@pytest.mark.asyncio
async def test_get_prompt_unknown():
    result = await mcp_server.get_prompt("nonexistent-prompt")
    assert "Unknown prompt" in result.messages[0].content.text


# ── URL builder ─────────────────────────────────────────────────────


def test_api_url_builder():
    assert mcp_server._api_url("/projects") == f"{mcp_server.API_BASE_URL}/api/v1/projects"


def test_headers_include_api_key():
    headers = mcp_server._headers()
    assert "X-API-Key" in headers
    assert headers["Content-Type"] == "application/json"
