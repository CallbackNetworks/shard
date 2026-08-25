"""Guard: the internal assistant's tool list cannot drift from MCP's unnoticed.

There are two hand-maintained agent tool registries — ``services/assistant_tools.TOOLS``
(37 tools, in-process, ~1700 lines) and ``mcp_server/server`` (51 tools, proxying
``/api/v1``, ~1800 lines). They overlap on 33 names and are kept in step by hand.

``test_mcp_reach.py`` guards MCP against the v1 API. Nothing guarded this pair, and
drift here is silent in the way this codebase keeps finding: both doors answer, both
look right, and an agent simply gets a different set of affordances depending on which
one it came through. ADR-0089 is the same shape one layer up — two assistant surfaces
whose prompt lists had diverged, so the same button sent different text.

This does **not** demand parity. ADR-0102 deliberately gave the internal assistant only
the task/project half of MCP's surface; the operational tools (backup, settings,
integrations, share administration) are MCP-only on purpose. What it demands is that
every difference is *written down*, and that a new one has to be added here on purpose.
"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

# MCP tools with no assistant counterpart, and why.
#
# Almost all of these are operational rather than about work: ADR-0102 scoped the
# internal assistant to tasks and projects, so an assistant that could rotate a share
# token or restore a backup would be a decision nobody made.
MCP_ONLY = {
    "get_agent_context": "onboarding for an external agent; the in-process assistant has the context already",
    "manage_backup": "operational (ADR-0091) — out of the assistant's scope by ADR-0102",
    "manage_settings": "operational (ADR-0091)",
    "manage_email": "operational (ADR-0091)",
    "manage_share": "share administration (ADR-0087); rotating a token is not an assistant act",
    "manage_integration": "outbound targets (ADR-0085)",
    "list_integrations": "outbound targets (ADR-0085)",
    "list_deliveries": "delivery log (ADR-0085)",
    "manage_workflow_rules": "rules engine (ADR-0085)",
    "get_rule_vocabulary": "rules engine (ADR-0085)",
    "trigger_pipeline": "pipeline dispatch (ADR-0085)",
    "retry_delivery": "delivery log (ADR-0085)",
    "manage_webhook": "inbound callback credentials (ADR-0084) — admin scope",
    "list_node_types": "type registry (ADR-0079); the assistant does not create layers",
    "manage_types": "type registry (ADR-0079)",
    "list_edge_types": "relation vocabulary (ADR-0078)",
    "manage_edges": "raw edge writes; the assistant works through named operations",
    "create_external_issue": "publishes outward (ADR-0092); not an assistant act",
}

# Assistant tools with no MCP counterpart, and why.
ASSISTANT_ONLY = {
    "create_decision": "decisions are POST /nodes on v1, so MCP needs no tool (ADR-0092)",
    "tag_task_with_decision": "an edge write; MCP reaches it through manage_edges",
    "analyze_decisions": "assembled in-process from data MCP can already read",
    "batch_create_tasks": "MCP batches through import_tasks",
}

# `project_id` is structural, not drift: MCP tools address /api/v1/projects/{id}/...,
# so the path parameter is part of the call. The in-process assistant resolves the
# project from the task it was handed.
STRUCTURAL_PARAMS = {"project_id"}

# Shared tools whose parameters genuinely differ, with the reason. These are real
# capability gaps, frozen so they cannot grow — not endorsed. Closing one means
# deleting its line.
PARAM_DIFFS = {
    "list_tasks": {"priority"},  # the assistant cannot filter by priority
    "get_analytics": {"days"},  # no window argument
    "get_graph_map": {"include"},  # cannot ask for the data payload
    "get_container_subtree": {"view"},  # no view selector
    "add_comment": {"author"},  # the assistant always writes as "assistant"
    "manage_attachments": {"content_base64", "content_type", "filename"},  # cannot upload
}


def _assistant_tools() -> dict[str, set[str]]:
    tree = ast.parse((APP / "services/assistant_tools.py").read_text())
    literal = next(
        ast.literal_eval(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "TOOLS" for t in node.targets)
    )
    return {t["name"]: set((t.get("input_schema") or {}).get("properties") or {}) for t in literal}


def _mcp_tools() -> dict[str, set[str]]:
    tree = ast.parse((APP / "mcp_server/server.py").read_text())
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        if any("tool" in ast.dump(d) for d in node.decorator_list):
            out[node.name] = {a.arg for a in node.args.args + node.args.kwonlyargs}
    return out


def test_both_registries_are_readable():
    """Anti-vacuity: a refactor of either literal must not make this check trivial."""
    assistant, mcp = _assistant_tools(), _mcp_tools()
    assert len(assistant) > 30, f"only {len(assistant)} assistant tools parsed"
    assert len(mcp) > 45, f"only {len(mcp)} MCP tools parsed"
    assert len(set(assistant) & set(mcp)) > 25


def test_every_mcp_only_tool_is_accounted_for():
    extra = sorted(set(_mcp_tools()) - set(_assistant_tools()) - set(MCP_ONLY))
    assert not extra, (
        f"MCP gained tools the internal assistant does not have: {extra}. Add them to the "
        "assistant, or list them in MCP_ONLY with the reason they are MCP's alone."
    )


def test_every_assistant_only_tool_is_accounted_for():
    extra = sorted(set(_assistant_tools()) - set(_mcp_tools()) - set(ASSISTANT_ONLY))
    assert not extra, (
        f"The assistant gained tools MCP does not have: {extra}. Add them to MCP, or list "
        "them in ASSISTANT_ONLY with the reason."
    )


def test_shared_tools_take_the_same_arguments():
    assistant, mcp = _assistant_tools(), _mcp_tools()
    problems = []
    for name in sorted(set(assistant) & set(mcp)):
        difference = (mcp[name] ^ assistant[name]) - STRUCTURAL_PARAMS - PARAM_DIFFS.get(name, set())
        if difference:
            problems.append(f"{name}: {sorted(difference)}")
    assert not problems, (
        "These tools exist on both doors but take different arguments, so an agent's "
        f"affordances depend on which door it used: {problems}. Make them agree, or add "
        "the parameter to PARAM_DIFFS with the reason."
    )


def test_the_exemption_lists_do_not_rot():
    """An entry for a tool that no longer exists is a claim about nothing."""
    assistant, mcp = _assistant_tools(), _mcp_tools()
    stale_mcp = sorted(set(MCP_ONLY) - set(mcp))
    stale_assistant = sorted(set(ASSISTANT_ONLY) - set(assistant))
    # A PARAM_DIFFS entry survives only while the difference does — closing a gap
    # without deleting its line leaves the list describing a capability that arrived.
    shared = set(assistant) & set(mcp)
    stale_params = sorted(
        name
        for name, params in PARAM_DIFFS.items()
        if name not in shared or not (params & (mcp[name] ^ assistant[name]))
    )
    assert not (stale_mcp or stale_assistant or stale_params), (
        f"stale MCP_ONLY: {stale_mcp}; stale ASSISTANT_ONLY: {stale_assistant}; "
        f"PARAM_DIFFS entries whose gap is closed (delete the line): {stale_params}"
    )
