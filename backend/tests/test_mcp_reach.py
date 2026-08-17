"""Every v1 endpoint is reachable from MCP, or is named here with a reason (ADR-0093).

The three agent surfaces — internal `/api`, `/api/v1` and the MCP registry — drift in one
direction: a capability gets a v1 door because that is where the work is, and the MCP tool
list quietly falls behind. That is how ``/api/v1`` came to offer eight analytics reports,
full recurrence CRUD, templates and the entire share configuration while the registry offered
none of them: nothing failed, the tools simply were not there.

Nothing derivable can catch that, because "this endpoint deliberately has no tool" is a
decision, not a fact about the code. So this is the ADR-0085 shape: enumerate the routes,
and fail on any one that is neither reachable nor named in a list beside its reason. A new
v1 endpoint therefore forces a choice — write the tool, or write down why not.

Coverage is measured against the paths the module actually calls, extracted from the source
including the ones built from a variable prefix, so a tool that stops calling an endpoint
fails this too.
"""

import re
from pathlib import Path

from app.main import app

SERVER = Path(__file__).resolve().parent.parent / "app" / "mcp_server" / "server.py"


# Endpoints with no tool, and why. Each entry is a decision someone made on purpose.
NO_TOOL = {
    # Self-describing endpoints. A tool whose output is the tool list is a loop.
    ("GET", "/tools-schema"): "describes the registry this test is about",
    ("GET", "/agent-context"): "served as an MCP resource and by get_agent_context",
    ("GET", "/edge-types/registry"): "list_edge_types serves the same vocabulary",
    # Whole-database payloads. Putting one in a model's context is all risk, no use.
    ("GET", "/backup/export"): "the entire database, credentials included (ADR-0091)",
    ("GET", "/backup/download/{x}"): "same, by filename",
    ("POST", "/backup/restore"): "base64 upload door; manage_backup restores by filename",
    ("GET", "/projects/{x}/tasks/{x}/attachments/{x}/download"): "returns file bytes",
    # Reachable another way, and a second tool would be the ADR-0087 duplicate.
    ("GET", "/subscriptions"): "manage_integration covers the same objects, unrestricted",
    ("POST", "/subscriptions"): "manage_integration covers the same objects, unrestricted",
    ("PATCH", "/subscriptions/{x}"): "manage_integration covers the same objects",
    ("DELETE", "/subscriptions/{x}"): "manage_integration covers the same objects",
    ("GET", "/subscriptions/events"): "manage_integration action='events' is the same list",
    ("GET", "/decisions/{x}"): "list_decisions and export_decision cover reading one",
    ("GET", "/projects/{x}/tasks/{x}"): "list_tasks and get_project_detail return the task",
    ("GET", "/nodes/{x}/events"): "get_activity covers the timeline; webhook history has its own",
    ("GET", "/notifications/unread-count"): "manage_notifications action='unread_count'",
    # Known gaps, deliberately not closed in this pass.
    ("PATCH", "/projects/{x}/tasks/{x}/comments/{x}"): "add_comment/list_comments would have to "
    "fold into one manage_comments, and add_comment is in live use",
    ("DELETE", "/projects/{x}/tasks/{x}/comments/{x}"): "same as the comment update",
    ("POST", "/projects/{x}/tasks/bulk"): "create_task and import_tasks cover batch creation",
}


def _segments(path: str) -> tuple[str, ...]:
    """A path as segments, with every parameter or interpolation collapsed to one wildcard."""
    return tuple("{x}" if s.startswith("{") and s.endswith("}") else s for s in path.strip("/").split("/"))


def _mcp_paths() -> set[tuple[str, ...]]:
    """Every v1 path the MCP module calls, including ones built from a variable prefix.

    Two shapes have to be resolved by hand because the path is assembled at runtime:
    ``base = f"/nodes/{node_id}/share"`` then ``_post(f"{base}/set-pin")``, and the ternary
    ``base = "/node-types" if kind == "node" else "/edge-types"``. A local name like ``base``
    or ``path`` is reused across functions, so each name maps to *every* value it is ever
    assigned and each is tried — over-generous by construction, which is the safe direction:
    this test's job is to catch an endpoint nothing reaches, not to police the extractor.
    """
    src = SERVER.read_text()
    prefixes: dict[str, set[str]] = {}
    for name, rhs in re.findall(r"^\s*(\w+)\s*=\s*(.+)$", src, re.MULTILINE):
        for value in re.findall(r'f?"(/[^"]*)"', rhs):
            prefixes.setdefault(name, set()).add(value)

    paths = set()
    for literal in re.findall(r'"((?:/|\{\w+\})[^"\s]*)"', src):
        if literal.startswith("/"):
            paths.add(_segments(literal))
            continue
        head = literal[1 : literal.index("}")]
        for value in prefixes.get(head, ()):
            paths.add(_segments(value + literal[literal.index("}") + 1 :]))
    return paths


def _v1_routes() -> set[tuple[str, str]]:
    routes = set()
    for path, ops in app.openapi()["paths"].items():
        if not path.startswith("/api/v1"):
            continue
        for method in ops:
            if method in ("get", "post", "put", "patch", "delete"):
                routes.add((method.upper(), path[len("/api/v1") :]))
    return routes


def _covered(path: str, mcp_paths: set[tuple[str, ...]]) -> bool:
    target = _segments(path)
    for candidate in mcp_paths:
        if len(candidate) != len(target):
            continue
        if all(c == "{x}" or t == "{x}" or c == t for c, t in zip(candidate, target, strict=True)):
            return True
    return False


def test_every_v1_endpoint_is_reachable_from_mcp_or_excused():
    mcp_paths = _mcp_paths()
    unreachable = sorted(
        (method, path)
        for method, path in _v1_routes()
        if not _covered(path, mcp_paths) and (method, "/".join(("", *_segments(path)))) not in _normalised(NO_TOOL)
    )
    assert not unreachable, (
        "These /api/v1 endpoints have no MCP tool and no recorded reason: "
        f"{unreachable}. Write the tool, or add the endpoint to NO_TOOL with why not."
    )


def _normalised(entries: dict) -> set[tuple[str, str]]:
    return {(method, "/".join(("", *_segments(path)))) for method, path in entries}


def test_no_tool_entries_are_not_stale():
    """An excuse that no longer describes a real endpoint is worse than no excuse: it reads
    as a considered decision about something that does not exist."""
    live = _normalised(_v1_routes())
    stale = sorted(entry for entry in _normalised(NO_TOOL) if entry not in live)
    assert not stale, f"NO_TOOL names endpoints that no longer exist: {stale}"


def test_endpoints_excused_as_duplicates_really_have_another_path():
    """The largest NO_TOOL category is 'reachable another way'. If that stops being true the
    entry becomes a gap wearing an excuse, so spot-check the tools it points at."""
    src = SERVER.read_text()
    for tool in ("manage_integration", "list_decisions", "export_decision", "get_activity", "list_tasks"):
        assert f"async def {tool}(" in src, f"NO_TOOL points at {tool}, which no longer exists"
