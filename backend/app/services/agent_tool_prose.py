"""One description per tool, for the two registries that offer the same tool (ADR-0161).

``services/assistant_tools.TOOLS`` and ``mcp_server/server`` overlap on 34 names.
``tests/test_assistant_tool_parity.py`` already pins the half that is structural — the
tool *names* and their *parameters*, with every real difference written down and frozen.
It checks no prose, and prose is what the model actually reads.

Measured: **27 of the 34 shared tools described themselves differently**, e.g.

    add_comment  assistant: "Add a comment to a task. Supports markdown."
                 mcp      : "Add a comment to a task. Useful for leaving notes,
                             progress updates, or context."

Neither is wrong and that is the point — there is no failure symptom, just a model that
gets a better hint about when to reach for a tool depending on which door it came
through. ADR-0089 is this exact defect one layer up, and the parity test's own docstring
cites it while checking names alone.

The direction is forced. ADR-0077 made an MCP tool's **signature its schema**, and
ADR-0086 made ``/api/v1/tools-schema`` a projection of that registry rather than a list
beside it, so the MCP side is already generated from the code it describes. The
assistant's was the remaining hand-written copy. A shared tool therefore carries **no**
description in ``TOOLS`` at all: if you see prose in ``assistant_tools.py``, the tool is
one of the four the assistant has and MCP does not.

Implementations stay apart on purpose. ADR-0005 has MCP proxying ``/api/v1`` over HTTP
while the assistant calls services with the in-process ``db``; that is a data-path
decision, and it is not what drifted.
"""

from functools import cache


@cache
def mcp_descriptions() -> dict[str, str]:
    """``{tool_name: description}`` from the MCP registry.

    Read through ``_tool_manager``, which is synchronous — ``mcp.list_tools()`` is a
    coroutine, and awaiting one to build a module-level list is how an import ends up
    depending on whether a loop is already running.

    Imported lazily: ``main.py`` only registers the MCP *route* when ``MCP_HTTP_TOKEN``
    is set (ADR-0080), and the assistant must not start caring whether it is.
    """
    from app.mcp_server.server import mcp

    return {t.name: (t.description or "").strip() for t in mcp._tool_manager.list_tools()}


def describe(name: str, local: str | None) -> str:
    """The prose for one tool. A local description wins; otherwise the registry's.

    Local-wins rather than shared-wins, because "this entry carries prose" then *means*
    "this tool is not the one MCP offers" — the four the assistant has and MCP does not,
    plus the few whose capability genuinely differs. Shared-wins would silently hand a
    tool a description of something it cannot do, which is worse than two descriptions:
    the model would read about a parameter that is not in the schema it was given.
    ``test_assistant_tool_parity.py`` pins which names are allowed to carry one, so the
    escape hatch cannot quietly become the rule again.

    Raises rather than returning a placeholder. A tool offered with an empty description
    is worse than one not offered at all — it will still be called, and the call will be
    a guess.
    """
    if local:
        return local
    shared = mcp_descriptions().get(name)
    if shared:
        return shared
    raise RuntimeError(
        f"tool '{name}' has no description on either side. A shared tool takes MCP's; a "
        f"tool that differs must carry its own in TOOLS."
    )
