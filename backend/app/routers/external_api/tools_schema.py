"""External API v1 — tool definitions for HTTP-based agents, generated (ADR-0086).

This used to be a hand-written list of ~22 OpenAI-format tool definitions, maintained
beside the MCP server's own registry and describing the same operations. It drifted, as a
second copy of a vocabulary always does in this codebase: by the time anyone looked it was
missing `manage_edges`, `list_node_types`, `get_container_subtree` and everything ADR-0085
added. An HTTP agent auto-discovering operations was being told a subset that nobody had
decided on — the list simply stopped being updated at some point.

ADR-0077 solved this once already, for MCP: a tool's *signature* is its schema, so the
registry cannot drift from the dispatch because there is no separate dispatch. That
registry is the thing to project from. This endpoint now renders it into OpenAI
function-calling shape and holds no vocabulary of its own — a tool added to the MCP server
appears here, and one removed disappears, with nothing to remember.

The two formats agree closely enough for this to be a rename: MCP's `input_schema` is
already JSON Schema, which is what `parameters` wants.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope

sub_router = APIRouter()


class ToolDefinition(BaseModel):
    name: str
    description: str
    parameters: dict


async def openai_tool_definitions() -> list[ToolDefinition]:
    """The MCP tool registry, in OpenAI function-calling shape.

    Imported inside the function so this module does not pull the MCP server (and its httpx
    client) into every import of the v1 package — the registry is only needed when somebody
    asks for it.
    """
    from app.mcp_server.server import mcp

    tools = await mcp.list_tools()
    return [
        ToolDefinition(
            name=tool.name,
            description=tool.description or "",
            # A tool with no arguments still needs a schema an OpenAI-style caller accepts.
            parameters=tool.input_schema or {"type": "object", "properties": {}, "required": []},
        )
        for tool in sorted(tools, key=lambda t: t.name)
    ]


@sub_router.get(
    "/tools-schema",
    response_model=list[ToolDefinition],
    summary="AI agent tool definitions",
    description=(
        "Available operations in OpenAI function-calling format, so an HTTP-based agent can "
        "auto-discover them without hand-configured schemas. Generated from the same tool "
        "registry the MCP server serves (ADR-0077), so the two cannot disagree about what "
        "exists. Requires `read` scope."
    ),
    responses=_auth_errors,
)
async def api_tools_schema(api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return await openai_tool_definitions()
