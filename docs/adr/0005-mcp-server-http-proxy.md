# ADR-0005: MCP Server HTTP Proxy Architecture

## Status
Accepted

## Date
2026-05-29

## Context

The MCP (Model Context Protocol) server allows AI tools like Claude Desktop and Cursor to interact with Shard via structured tool calls over stdio transport.

The original implementation (`mcp_server/server.py`) accessed the SQLite database directly using raw `sqlite3` queries. This design bypassed the FastAPI application layer entirely, causing several silent data integrity issues:

- **No activity logging**: Mutations made via MCP did not appear in the activity log.
- **No outbound notifications**: Task status changes did not fire webhook or email notifications.
- **No workflow rules**: The rules engine (`run_rules()`) was never triggered for MCP-originated changes.
- **No WebSocket broadcasts**: The frontend did not receive real-time updates for MCP mutations.
- **SQLite locking risk**: Two processes (FastAPI + MCP) concurrently writing to the same SQLite file could cause `SQLITE_BUSY` errors.
- **Schema drift**: The MCP server's raw SQL had to be manually kept in sync with ORM model changes.

Additionally, the MCP Dockerfile used `CMD ["tail", "-f", "/dev/null"]` and never actually started the server process.

## Decision

Rewrite the MCP server as a thin HTTP proxy that calls the existing `/api/v1` REST endpoints via `httpx`. The MCP server authenticates to the backend using a dedicated API key (`MCP_API_KEY` environment variable).

This approach was chosen over alternatives:
- **Importing FastAPI services directly** was rejected because the MCP server runs in a separate container and the FastAPI app uses async SQLAlchemy sessions tied to request lifecycle.
- **Shared SQLite with WAL mode** was rejected because it only solves locking, not the missing business logic (notifications, rules, activity logging).

The MCP server now depends on the backend service and communicates over the Docker internal network (`http://backend:8000`).

## Consequences

**Positive:**
- All business logic (activity logging, notifications, workflow rules, WebSocket broadcasts) is applied consistently regardless of whether mutations come from the web UI, External API, or MCP.
- The MCP server has zero knowledge of the database schema; it only knows HTTP endpoints.
- API key scoping and rate tracking work identically for MCP and other API consumers.
- MCP mutations appear in the activity log with the actor name matching the API key (e.g., `api:mcp-server`).

**Negative:**
- The MCP server now depends on the backend being healthy. If the backend is down, MCP tools return errors.
- There is a small latency overhead from HTTP calls compared to direct SQLite access (~1-5ms per call on the Docker network).
- Users must create an API key and configure `MCP_API_KEY` in `.env` for the MCP server to function.
