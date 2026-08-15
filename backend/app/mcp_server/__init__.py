"""MCP server — the protocol skin over this application's own ``/api/v1``.

It lives inside the backend package rather than beside it (ADR-0080): a
standalone container was a requirement of the stdio era, where the client
launched the process itself. Since ADR-0076 wired up the remote HTTP
transport, that requirement is gone, and an independent deployment unit was
buying isolation this layer has no use for.

Two entry points, one module: ``python -m app.mcp_server.server`` speaks stdio
(the client owns the process), and the HTTP transport is served by the backend
process itself. Either way the tools call ``/api/v1`` over httpx — co-locating
processes is a deployment decision, not a data-path one (ADR-0005 stands).
"""
