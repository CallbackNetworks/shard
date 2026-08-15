"""Tests for MCP server tool implementations, resources, and prompts.

All HTTP calls are mocked via httpx — no backend required.
"""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError

from app.mcp_server import server as mcp_server

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
    return patch("app.mcp_server.server.httpx.AsyncClient", return_value=client)


async def _call(tool_name, arguments=None):
    """Call a tool through the real registry and return the text result.

    Goes through ``mcp.call_tool`` rather than a module-level dispatch function:
    after ADR-0077 there is no dispatch to call: the registry the SDK builds from
    the decorators *is* the thing under test, so this exercises argument
    validation and routing too, not just the implementation behind them.
    """
    result = await mcp_server.mcp.call_tool(tool_name, arguments or {})
    assert len(result.content) == 1
    return result.content[0].text


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
        await _call("list_tasks", {"project_id": "p1", "status": "done", "priority": "high"})
        client = mock_cls.return_value
        call_args = client.get.call_args
        assert call_args[1]["params"]["status_filter"] == "done"
        assert call_args[1]["params"]["priority"] == "high"


# ── Tool: create_task ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_task():
    created = {"id": "t3", "title": "New task", "priority": "high"}
    with _patch_client("post", _mock_response(json_data=created)) as mock_cls:
        text = await _call(
            "create_task",
            {
                "project_id": "p1",
                "title": "New task",
                "priority": "high",
                "description": "Some desc",
                "assignee": "alice",
                "due_date": "2026-07-01",
            },
        )
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
        text = await _call("create_subtask", {"project_id": "p1", "parent_task_id": "t1", "title": "Sub"})
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
    """A missing required argument is refused before the tool body runs.

    The old dispatch read arguments with `.get()` and let the body return the
    string "project_id required for list action" as a *successful* result, even
    though the declared schema already marked it required. The schema is now
    enforced (ADR-0077), so the contract and the behaviour agree.
    """
    with pytest.raises(ToolError):
        await _call("manage_labels", {"action": "list"})


@pytest.mark.asyncio
async def test_manage_labels_add():
    with _patch_client("post", _mock_response(json_data={"status": "ok"})):
        text = await _call("manage_labels", {"action": "add", "project_id": "p1", "task_id": "t1", "label_id": "l1"})
    parsed = json.loads(text)
    assert parsed["status"] == "ok"


@pytest.mark.asyncio
async def test_manage_labels_add_missing_params():
    text = await _call("manage_labels", {"action": "add", "project_id": "p1"})
    assert "required" in text


@pytest.mark.asyncio
async def test_manage_labels_remove():
    with _patch_client("delete", _mock_response(status_code=204)):
        text = await _call("manage_labels", {"action": "remove", "project_id": "p1", "task_id": "t1", "label_id": "l1"})
    parsed = json.loads(text)
    assert parsed["status"] == "deleted"


@pytest.mark.asyncio
async def test_manage_labels_unknown_action():
    """A value outside the declared enum is refused, not answered."""
    with pytest.raises(ToolError):
        await _call("manage_labels", {"action": "rename", "project_id": "p1"})


# ── Tool: analyze_workload ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_analyze_workload_with_project():
    stats = {"total": 10, "done": 5}
    with _patch_client("get", _mock_response(json_data=stats)) as mock_cls:
        await _call("analyze_workload", {"project_id": "p1"})
        url = mock_cls.return_value.get.call_args[0][0]
        assert "/projects/p1/stats" in url


@pytest.mark.asyncio
async def test_analyze_workload_overview():
    overview = {"total_tasks": 50}
    with _patch_client("get", _mock_response(json_data=overview)) as mock_cls:
        await _call("analyze_workload", {})
        url = mock_cls.return_value.get.call_args[0][0]
        assert "/analytics/overview" in url


# ── Tool: search ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search():
    results = {"tasks": [{"id": "t1"}], "projects": []}
    with _patch_client("get", _mock_response(json_data=results)) as mock_cls:
        await _call("search", {"query": "deploy"})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["q"] == "deploy"


# ── Tool: get_activity ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_activity():
    activities = [{"id": "a1", "action": "task.created"}]
    with _patch_client("get", _mock_response(json_data=activities)) as mock_cls:
        await _call("get_activity", {"limit": 5})
        params = mock_cls.return_value.get.call_args[1]["params"]
        assert params["limit"] == 5


# ── Tool: add_comment ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_comment():
    comment = {"id": "c1", "body": "Nice work"}
    with _patch_client("post", _mock_response(json_data=comment)) as mock_cls:
        await _call("add_comment", {"project_id": "p1", "task_id": "t1", "body": "Nice work", "author": "bob"})
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
        text = await _call("manage_dependencies", {"action": "list", "project_id": "p1", "task_id": "t1"})
    parsed = json.loads(text)
    assert "blocked_by" in parsed


@pytest.mark.asyncio
async def test_manage_dependencies_add():
    with _patch_client("post", _mock_response(json_data={"status": "ok"})):
        text = await _call(
            "manage_dependencies", {"action": "add", "project_id": "p1", "task_id": "t1", "depends_on_id": "t2"}
        )
    parsed = json.loads(text)
    assert parsed["status"] == "ok"


@pytest.mark.asyncio
async def test_manage_dependencies_add_missing_id():
    text = await _call("manage_dependencies", {"action": "add", "project_id": "p1", "task_id": "t1"})
    assert "depends_on_id required" in text


@pytest.mark.asyncio
async def test_manage_dependencies_remove():
    with _patch_client("delete", _mock_response(status_code=204)):
        text = await _call(
            "manage_dependencies", {"action": "remove", "project_id": "p1", "task_id": "t1", "depends_on_id": "t2"}
        )
    parsed = json.loads(text)
    assert parsed["status"] == "deleted"


@pytest.mark.asyncio
async def test_manage_dependencies_unknown_action():
    with pytest.raises(ToolError):
        await _call("manage_dependencies", {"action": "reorder", "project_id": "p1", "task_id": "t1"})


# ── Tool: get_notifications ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_notifications():
    notifs = [{"id": "n1", "type": "task.done"}]
    with _patch_client("get", _mock_response(json_data=notifs)) as mock_cls:
        await _call("get_notifications", {"unread_only": False, "limit": 10})
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
        await _call(
            "report_progress",
            {
                "project_id": "p1",
                "task_id": "t1",
                "progress_pct": 75,
                "agent_notes": "Almost done",
                "comment": "Update",
            },
        )
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
        await _call("list_projects", {"status": "active"})
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
        await _call("create_project", {"name": "Delta"})
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
    """An unknown tool is an error, not a result whose text says "Unknown tool"."""
    with pytest.raises(ToolError):
        await _call("nonexistent_tool", {})


# ── Tool error handling ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tool_exception_handling():
    """A failing tool reports failure.

    The catch-all used to turn any exception into the text "Tool error: ..." on
    an otherwise successful result — a failure a client could only detect by
    reading the prose. It now surfaces as an error (ADR-0077), the same
    distinction ADR-0051 drew for unrecognised webhook statuses.
    """
    with patch("app.mcp_server.server._get_summary", side_effect=Exception("connection refused")):
        with pytest.raises(ToolError, match="connection refused"):
            await _call("get_summary")


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


# ── Tool: get_container_subtree ─────────────────────────────────────


@pytest.mark.asyncio
async def test_get_container_subtree():
    """ADR-0065: an agent can see the containers below a node, not just its own tasks."""
    data = {
        "id": "p1",
        "type": "project",
        "title": "Split work",
        "total_tasks": 8,
        "done_tasks": 3,
        "direct_task_count": 6,
        "child_container_count": 1,
        "children": [{"id": "a1", "type": "area", "title": "Nested area", "total_tasks": 2}],
    }
    with _patch_client("get", _mock_response(json_data=data)) as _:
        text = await _call("get_container_subtree", {"node_id": "p1"})
    parsed = json.loads(text)
    assert parsed["total_tasks"] == 8
    assert [c["title"] for c in parsed["children"]] == ["Nested area"]


@pytest.mark.asyncio
async def test_get_container_subtree_error():
    with _patch_client("get", _mock_response(status_code=404, text="node not found")):
        text = await _call("get_container_subtree", {"node_id": "nope"})
    assert "Error 404" in text


# ── Tools: node types (ADR-0079) ────────────────────────────────────


@pytest.mark.asyncio
async def test_list_node_types():
    with _patch_client("get", _mock_response(json_data=[{"key": "project", "roles": ["container"]}])):
        text = await _call("list_node_types", {})
    assert json.loads(text)[0]["key"] == "project"


@pytest.mark.asyncio
async def test_create_node_type():
    with _patch_client("post", _mock_response(json_data={"key": "organization", "roles": ["container"]})):
        text = await _call("create_node_type", {"key": "organization", "label": "Organization", "roles": ["container"]})
    assert json.loads(text)["key"] == "organization"


# ── Tools: list_edge_types / manage_edges (ADR-0078) ────────────────


@pytest.mark.asyncio
async def test_list_edge_types():
    relations = {"relations": [{"key": "owns", "description": "Identity -> container"}]}
    with _patch_client("get", _mock_response(json_data=relations)):
        text = await _call("list_edge_types", {})
    assert json.loads(text)["relations"][0]["key"] == "owns"


@pytest.mark.asyncio
async def test_manage_edges_list():
    with _patch_client("get", _mock_response(json_data=[{"rel_type": "contains"}])):
        text = await _call("manage_edges", {"action": "list", "node_id": "n1"})
    assert json.loads(text)[0]["rel_type"] == "contains"


@pytest.mark.asyncio
async def test_manage_edges_add():
    with _patch_client("post", _mock_response(json_data={"rel_type": "owns"})):
        text = await _call("manage_edges", {"action": "add", "node_id": "i1", "target_id": "p1", "rel_type": "owns"})
    assert json.loads(text)["rel_type"] == "owns"


@pytest.mark.asyncio
async def test_manage_edges_add_without_a_relation_says_so():
    """The backend would refuse it anyway; failing here costs no round trip."""
    text = await _call("manage_edges", {"action": "add", "node_id": "i1", "target_id": "p1"})
    assert "rel_type" in text


@pytest.mark.asyncio
async def test_manage_edges_remove():
    with _patch_client("delete", _mock_response(status_code=204)):
        text = await _call("manage_edges", {"action": "remove", "node_id": "i1", "target_id": "p1", "rel_type": "owns"})
    assert json.loads(text)["status"] == "deleted"


# ── MCP registry: list_tools ────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_tools_count():
    tools = await mcp_server.mcp.list_tools()
    assert len(tools) == 25


@pytest.mark.asyncio
async def test_list_tools_names():
    tools = await mcp_server.mcp.list_tools()
    names = {t.name for t in tools}
    expected = {
        "get_summary",
        "list_tasks",
        "create_task",
        "update_task",
        "create_subtask",
        "manage_labels",
        "analyze_workload",
        "search",
        "get_activity",
        "add_comment",
        "list_comments",
        "manage_dependencies",
        "get_notifications",
        "get_agent_context",
        "report_progress",
        "list_projects",
        "create_project",
        "delete_task",
        "get_project_detail",
        "bulk_update_tasks",
        "get_container_subtree",
        # ADR-0078: edges had no tool at all, so an agent could only ever set the one
        # container_id a node was created with.
        "list_edge_types",
        "manage_edges",
        # ADR-0079: `type` is required on every node write and nothing listed the
        # legal values; creating a layer was a UI-only capability.
        "list_node_types",
        "create_node_type",
    }
    assert names == expected


# ── MCP registry: list_resources ────────────────────────────────────


@pytest.mark.asyncio
async def test_list_resources():
    resources = await mcp_server.mcp.list_resources()
    assert len(resources) == 4
    uris = {str(r.uri) for r in resources}
    assert "todo://summary" in uris
    assert "todo://activity" in uris
    assert "todo://notifications" in uris
    assert "todo://agent-context" in uris


# ── MCP registry: list_resource_templates ───────────────────────────


@pytest.mark.asyncio
async def test_list_resource_templates():
    templates = await mcp_server.mcp.list_resource_templates()
    assert len(templates) == 1
    assert "project_id" in templates[0].uri_template


# ── MCP: read_resource ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_read_resource_summary():
    data = {"total_projects": 2}
    with _patch_client("get", _mock_response(json_data=data)):
        result = list(await mcp_server.mcp.read_resource("todo://summary"))
    assert len(result) == 1
    parsed = json.loads(result[0].content)
    assert parsed["total_projects"] == 2


@pytest.mark.asyncio
async def test_read_resource_project():
    data = {"id": "p1", "name": "Test", "tasks": []}
    with _patch_client("get", _mock_response(json_data=data)):
        result = list(await mcp_server.mcp.read_resource("todo://projects/p1"))
    parsed = json.loads(result[0].content)
    assert parsed["id"] == "p1"


@pytest.mark.asyncio
async def test_read_resource_unknown():
    """An unregistered URI is an error, not a resource whose body says "error".

    The hand-rolled reader fell through to `{"error": ...}` with a 200-shaped
    result, so a client had to parse the body to find out the read failed.
    The registry raises instead (ADR-0077).
    """
    with pytest.raises(ResourceNotFoundError):
        await mcp_server.mcp.read_resource("todo://nope")


# ── MCP: list_prompts ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_prompts():
    prompts = await mcp_server.mcp.list_prompts()
    assert len(prompts) == 4
    names = {p.name for p in prompts}
    assert names == {"plan-my-day", "project-review", "triage-inbox", "weekly-summary"}


# ── MCP: get_prompt ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_prompt_plan_my_day():
    result = await mcp_server.mcp.get_prompt("plan-my-day")
    assert len(result.messages) == 1
    assert "overdue" in result.messages[0].content.text.lower()


@pytest.mark.asyncio
async def test_get_prompt_project_review():
    result = await mcp_server.mcp.get_prompt("project-review", {"project_name": "Alpha"})
    assert "Alpha" in result.messages[0].content.text


@pytest.mark.asyncio
async def test_get_prompt_unknown():
    """An unregistered prompt raises rather than returning a prompt that says so."""
    with pytest.raises(ValueError, match="Unknown prompt"):
        await mcp_server.mcp.get_prompt("nonexistent-prompt")


# ── HTTP client config ──────────────────────────────────────────────
# The client bakes in the /api/v1 base URL and auth/content headers, so relative
# tool paths ("/projects", "/nodes/{id}") resolve against it.


def test_client_base_url():
    client = mcp_server._get_client()
    assert str(client.base_url).rstrip("/") == f"{mcp_server.API_BASE_URL}/api/v1"


def test_client_headers_include_api_key():
    client = mcp_server._get_client()
    assert "X-API-Key" in client.headers
    assert client.headers["Content-Type"] == "application/json"


# ── HTTP transport (ADR-0076) ────────────────────────────────────────


def test_http_app_refuses_to_start_without_a_token(monkeypatch):
    """An HTTP MCP endpoint without a token publishes every tool to anyone who can reach it.

    Over stdio the client owns the process; over HTTP the door is open to the network, and
    each tool acts with the server's own API key. The check used to be ``if http_token:``,
    so an unset variable meant no check at all — the shape ADR-0060 removed from webhook
    signatures. Refusing to boot is the only state that cannot be reached by forgetting.
    """
    monkeypatch.delenv("MCP_HTTP_TOKEN", raising=False)
    with pytest.raises(SystemExit) as exc:
        mcp_server.create_http_app()
    assert "MCP_HTTP_TOKEN" in str(exc.value)

    monkeypatch.setenv("MCP_HTTP_TOKEN", "")
    with pytest.raises(SystemExit):
        mcp_server.create_http_app()


@pytest.mark.asyncio
async def test_http_endpoint_rejects_wrong_and_missing_tokens(monkeypatch):
    """Every unauthenticated shape is refused, and the right token gets past the check."""
    from starlette.testclient import TestClient

    monkeypatch.setenv("MCP_HTTP_TOKEN", "s3cret-token")
    transport = mcp_server.create_http_app()

    with TestClient(mcp_server.create_standalone_app(transport)) as client:
        for headers in (
            {},
            {"Authorization": "Bearer wrong-token"},
            {"Authorization": "Bearer "},
            {"Authorization": "s3cret-token"},  # right token, no scheme: still refused
            {"Authorization": "Basic s3cret-token"},
        ):
            r = client.post("/mcp", json={}, headers=headers)
            assert r.status_code == 401, headers
            assert r.json() == {"error": "Unauthorized"}

        # The right token gets past the guard, in either casing of the scheme (RFC 7235).
        # What the MCP session layer then makes of the request is its own business — the
        # assertion is only that the door opened.
        for scheme in ("Bearer", "bearer"):
            r = client.post(
                "/mcp",
                json={},
                headers={
                    "Authorization": f"{scheme} s3cret-token",
                    "Accept": "application/json, text/event-stream",
                },
            )
            assert r.status_code != 401, scheme


# ── Mounted in the backend process (ADR-0080) ────────────────────────


def _mounted_app(transport):
    """A host that mounts the transport the way `app.main` does.

    Deliberately built by hand rather than by reloading `app.main`: what is under
    test is the *shape* of the mount — a `Route` with an ASGI endpoint, and a
    lifespan the host enters itself — and reloading the real module would test the
    import machinery instead.
    """
    from contextlib import asynccontextmanager

    from fastapi import FastAPI
    from starlette.routing import Route

    @asynccontextmanager
    async def lifespan(app):
        async with transport.lifespan():
            yield

    host = FastAPI(lifespan=lifespan)
    host.router.routes.append(Route("/mcp", endpoint=transport, methods=["GET", "POST", "DELETE"], name="mcp"))
    return host


def test_the_guard_is_mounted_as_an_asgi_app_not_a_handler(monkeypatch):
    """`Route` must hand the request to the guard, not call it as `func(request)`.

    `starlette.routing.Route` asks `inspect.isfunction` and wraps a function as
    `func(request) -> response`. The session manager writes its own response, so a
    function endpoint would leave Starlette waiting for a `Response` that never
    comes. Turning `BearerGuard` back into a closure fails here rather than in
    production, where the symptom is a hung MCP client.
    """
    from starlette.routing import Route

    monkeypatch.setenv("MCP_HTTP_TOKEN", "s3cret-token")
    transport = mcp_server.create_http_app()

    assert Route("/mcp", endpoint=transport).app is transport


def test_mounted_endpoint_refuses_unauthenticated_and_completes_a_handshake(monkeypatch):
    """The door still guards it when the host is the backend, and the transport works."""
    from starlette.testclient import TestClient

    monkeypatch.setenv("MCP_HTTP_TOKEN", "s3cret-token")
    transport = mcp_server.create_http_app()

    with TestClient(_mounted_app(transport)) as client:
        assert client.post("/mcp", json={}).status_code == 401

        r = client.post(
            "/mcp",
            headers={
                "Authorization": "bearer s3cret-token",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"},
                },
            },
        )
        assert r.status_code == 200
        assert '"serverInfo"' in r.text and '"shard"' in r.text


def test_a_host_that_skips_the_lifespan_serves_a_broken_endpoint(monkeypatch):
    """Negative control: forgetting the lifespan is a runtime failure, not a startup one.

    A route endpoint never sees a lifespan scope, so the session manager the SDK
    starts there is only running if the host entered `transport.lifespan()`. Without
    it the app boots clean and every authenticated call fails — the shape worth
    pinning, because the symptom appears nowhere near the omission.
    """
    from fastapi import FastAPI
    from starlette.routing import Route
    from starlette.testclient import TestClient

    monkeypatch.setenv("MCP_HTTP_TOKEN", "s3cret-token")
    transport = mcp_server.create_http_app()

    host = FastAPI()  # no lifespan: the session manager is never started
    host.router.routes.append(Route("/mcp", endpoint=transport, methods=["GET", "POST", "DELETE"], name="mcp"))

    with TestClient(host, raise_server_exceptions=False) as client:
        # The guard still answers — it is the transport behind it that is not running.
        assert client.post("/mcp", json={}).status_code == 401
        r = client.post(
            "/mcp",
            headers={
                "Authorization": "bearer s3cret-token",
                "Accept": "application/json, text/event-stream",
            },
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )
        assert r.status_code >= 500


def test_the_backend_mcp_route_follows_the_token(client):
    """The route exists exactly when a token configures it, and never unguarded.

    ADR-0076's rule — never a half-configured public endpoint — moves from "the
    deploy does not generate the service" to "the app does not register the route".
    Asserted as the rule rather than as one environment's answer: CI has no token
    and a developer's `.env` may well have one, and a test that only passes in the
    first is a test that fails for the wrong reason in the second.
    """
    from app import main

    status = client.post("/mcp", json={}).status_code
    if main._mcp_transport is None:
        # Absent, not broken: a 502 would mean the path exists with nothing behind it.
        assert status == 404
    else:
        assert status == 401


def test_mcp_bypasses_the_spa_password_gate(client, monkeypatch):
    """An MCP client has no browser session to offer, and its own token to present.

    Distinguished by *body*, not status: the SPA gate and the MCP door both answer
    401, so a status assertion alone would pass even if the gate had swallowed the
    request. `{"detail": ...}` is the gate; `{"error": ...}` is the door.
    """
    from app.routers import auth as auth_mod

    monkeypatch.setattr(auth_mod, "auth_enabled", lambda: True)

    r = client.post("/mcp", json={})
    assert r.status_code in (404, 401)
    if r.status_code == 401:
        assert r.json() == {"error": "Unauthorized"}

    gated = client.get("/api/projects")
    assert gated.status_code == 401
    assert gated.json() == {"detail": "Unauthorized"}
