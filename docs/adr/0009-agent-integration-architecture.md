# ADR-0009: Agent Integration Architecture

## Status
Accepted

## Date
2026-07-04

## Context
Multiple AI agent types (Claude Code, OpenCode, Hermes) need to interact with Shard as external clients to manage tasks. Each agent has different access patterns:

- **Claude Code / OpenCode**: support MCP protocol (stdio and HTTP transport)
- **Hermes / custom agents**: use HTTP APIs with function-calling tool definitions

The platform already had an MCP server (ADR-0005) and External API v1, but lacked: tool schema discovery for HTTP agents, rate limiting, agent identity tracking, and the webhook dispatch path blocked request handling.

## Decision

We adopted a layered approach:

1. **Tool discovery endpoint** (`GET /api/v1/tools-schema`): returns all available operations as an array of OpenAI function-calling-format tool definitions, enabling HTTP-based agents to auto-discover capabilities without manual schema authoring.

2. **Rate limiting** (120 req/min per API key): in-memory sliding window on the existing `RateLimiter` class, applied as an APIRouter dependency on `/api/v1/`. No external dependencies (Redis, etc.) — acceptable for a personal tool that restarts cleanly.

3. **Agent identity tracking** (`X-Agent-Id` header): optional header recorded in activity logs via `_build_actor()`. Format: `api:<key-name>:<agent-id>`. Allows distinguishing which agent instance performed which actions.

4. **Background webhook dispatch**: `fire_notifications()` now creates the `WebhookDelivery` record synchronously (visible immediately) then fires the actual HTTP call as an `asyncio.create_task` with its own `SessionLocal` DB session. This prevents slow webhook targets from blocking API responses. Test and retry flows remain inline (caller needs the result).

5. **MCP connection pooling**: replaced per-request `httpx.AsyncClient` context managers with a module-level persistent client (`_get_client()`), eliminating TCP handshake overhead on every tool call.

6. **New MCP tools**: `get_project_detail` (single call for project + all tasks) and `bulk_update_tasks` (batch status/priority changes), bringing the total to 20.

We chose NOT to:
- Add external rate-limiting infrastructure (Redis) — overkill for single-user deployment
- Make the scheduler a separate service — the DB-poll retry pattern (`next_retry_at`) already handles restarts gracefully
- Add circuit breaker for webhooks — background dispatch already prevents the main failure mode (blocked requests); the retry backoff `[1, 5, 30, 120, 360]` minutes provides natural back-off

## Consequences

**Positive:**
- HTTP agents can self-discover all available tools without documentation
- Webhook failures no longer block API responses
- Activity logs distinguish between different agent instances
- MCP tool calls are faster due to connection reuse
- Rate limiting prevents runaway agent loops from overwhelming the DB

**Negative:**
- In-memory rate limiter resets on restart (acceptable for personal tool)
- Background webhook dispatch means the caller doesn't know the delivery result inline (delivery status is queryable via `/api/v1/webhook-logs`)
- `SessionLocal` import in background task creates a coupling to the database module (but this is already the pattern used elsewhere)
