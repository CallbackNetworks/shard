# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

All services run in Docker with hot-reload. **Never install Python packages or Node modules on the host.**

```bash
docker compose up --build   # first run or after changing requirements.txt / package.json
docker compose up           # subsequent runs (hot-reload active)

# With PostgreSQL:
docker compose --profile postgres up --build
# Set in .env: DATABASE_URL=postgresql+psycopg://todo:todo_dev@postgres:5432/shard

# With MySQL:
docker compose --profile mysql up --build
# Set in .env: DATABASE_URL=mysql+pymysql://todo:todo_dev@mysql:3306/shard
```

- Backend API + Swagger UI: http://localhost:8000/docs
- Frontend: http://localhost:5173/app

Logs: `docker compose logs -f backend` / `docker compose logs -f frontend`

### Dependency changes

```bash
# Python: edit backend/requirements.txt then:
docker compose build backend && docker compose up

# JS: edit frontend/package.json then remove the cached volume first:
docker compose down
docker volume rm 20260318_frontend_modules
docker compose up --build
```

### Production build

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
# MCP server only starts with explicit profile:
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile mcp up -d
```

### Environment variables (`.env` in project root)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Database connection string (default `sqlite:///./shard.db`). Supports `sqlite`, `postgresql+psycopg`, `mysql+pymysql` |
| `DB_POOL_SIZE` | Connection pool size for PostgreSQL/MySQL (default `5`) |
| `DB_MAX_OVERFLOW` | Max overflow connections for PostgreSQL/MySQL (default `10`) |
| `DB_POOL_TIMEOUT` | Pool timeout in seconds for PostgreSQL/MySQL (default `30`) |
| `DB_SSL_MODE` | SSL mode for PostgreSQL cloud connections (e.g. `require`) |
| `AUTH_PASSWORD` | Password-protect `/app`; leave empty for no auth |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_USE_TLS` | Email notifications |
| `LLM_PROVIDER` | `claude` \| `openai` \| `stub` (default `stub`) |
| `LLM_API_KEY` | API key for the chosen LLM provider |
| `LLM_MODEL` | Model name (e.g. `claude-sonnet-4-6` for Claude, `gpt-4o` for OpenAI) |
| `SUMMARY_HOUR` | Hour (UTC) to send daily summary email (default `8`) |
| `AGENT_CONTEXT_INSTRUCTIONS` | Global instructions for AI agents (shown in `/api/v1/agent-context`) |
| `MCP_API_KEY` | API key for MCP server to authenticate with backend |
| `MCP_TRANSPORT` | `stdio` (default) or `http` for remote access |
| `MCP_HTTP_PORT` | Port for MCP HTTP transport (default `8001`) |
| `MCP_HTTP_TOKEN` | Bearer token to protect MCP HTTP endpoint |

## Testing

### Backend (pytest)

```bash
# All tests with coverage
docker compose exec backend pytest tests/ -v --tb=short --cov=app --cov-report=term-missing

# Single test file
docker compose exec backend pytest tests/test_tasks.py -v

# Single test function
docker compose exec backend pytest tests/test_tasks.py::test_create_task -v
```

Tests use an in-memory SQLite database (via `StaticPool`). The `conftest.py` provides `db`, `client`, `sample_identity`, and `sample_project` fixtures. Auth middleware is disabled in tests (`AUTH_PASSWORD=""`).

CI enforces `--cov-fail-under=70`.

### Frontend (vitest)

```bash
# All tests
docker compose exec frontend npx vitest run

# Watch mode
docker compose exec frontend npx vitest

# Single test file
docker compose exec frontend npx vitest run src/components/__tests__/TaskIcons.test.jsx
```

Tests use jsdom environment with `@testing-library/react`. Setup file: `src/test/setup.js`.

## Linting & formatting

### Backend (ruff)

```bash
docker compose exec backend ruff check app/ tests/      # lint
docker compose exec backend ruff format --check app/ tests/  # format check
docker compose exec backend ruff format app/ tests/      # auto-format
```

Config in `backend/pyproject.toml`: line-length 120, rules `E,F,I,W,UP,B`. Ignored: `B008` (function call in default arg — FastAPI `Depends()`), `E501` (line length handled by formatter).

### Frontend (ESLint)

```bash
docker compose exec frontend npm run lint
```

Config in `frontend/eslint.config.js` (flat config). CI allows up to 300 warnings (`--max-warnings 300`).

## CI pipeline (`.github/workflows/ci.yml`)

Runs on push/PR to `main`. Four jobs:
1. **Backend**: ruff lint + format check, pytest with coverage (>=70%), pip-audit
2. **Frontend**: ESLint, vitest, npm audit, vite build
3. **Docker build**: `docker compose build --no-cache`
4. **Integration**: production compose up, backend health check, frontend smoke test

## Schema migrations (Alembic)

```bash
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'description'"
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

Alembic uses `render_as_batch=True` for SQLite compatibility. Legacy `ALTER TABLE` blocks remain in `main.py` lifespan for backward compat — new schema changes should use Alembic.

## Backend architecture (`backend/app/`)

**Entry point: `main.py`**
- Registers all routers
- `lifespan` context: runs `Base.metadata.create_all()` + legacy `ALTER TABLE` migrations, then starts the background scheduler as an `asyncio.Task`
- Auth middleware reads `AUTH_PASSWORD`; bypasses `/auth/`, `/health`, `/webhook/`, `/share/`, `/docs`, `/openapi.json`, `/redoc`, `/api/v1/`

**Data layer**
- `models.py` — all SQLAlchemy ORM models (SQLite)
- `schemas.py` — all Pydantic v2 request/response types
- `database.py` — `SessionLocal`, `Base`, `get_db` dependency

### Key patterns

**`ws_manager`** (`services/ws_manager.py`): singleton `ConnectionManager` for WebSocket broadcast. Call `await ws_manager.broadcast(event, data)` after mutations in routers. Frontend auto-reconnects and invalidates React Query caches on events.

**`_enrich_task(task, db=None)`** in `routers/projects.py`: the single aggregation point for `TaskOut`. Computes `labels`, `subtask_count`, `comment_count`, `blocked_by[]`, `blocking[]`, and `recurrence`. Always pass `db` when recurrence data is needed. Called by `_enrich(project, db)` which also computes progress, cycle stats, and identities.

**`log_activity(db, action, *, project_id, task_id, actor, detail, meta)`** in `services/activity.py`: call after every meaningful mutation; does `db.flush()` not `db.commit()`.

**`fire_notifications(db, task, event)`** in `services/notifier.py`: sends to all matching active integrations. Webhook-type integrations get HMAC-SHA256 `X-Signature`/`X-Hub-Signature-256` headers; email integrations use SMTP. Creates a `WebhookDelivery` log row per attempt with retry backoff `[1, 5, 30, 120, 360]` minutes.

**`run_rules(db, trigger, task, context)`** in `services/rules_engine.py`: evaluates active `WorkflowRule` rows. Called from `tasks.py` after create (`task.created`) and after status/priority changes. Pass `_rule_depth=1` in context from rule-triggered updates to prevent infinite loops (max depth 2).

**Scheduler** (`services/scheduler.py`): asyncio loop, ticks every 3600 s. Runs four checks: due-date reminders (`task.due_soon`/`task.overdue`), recurring task generation, failed webhook retries, and daily summary email (sent once per day at `SUMMARY_HOUR` UTC to all email-type integrations).

**LLM assistant** (`services/llm.py` + `services/assistant_tools.py`): provider-agnostic. `get_provider()` reads `LLM_PROVIDER` env var and returns `ClaudeProvider`, `OpenAIProvider`, or `StubProvider`. Tools: `get_summary`, `list_tasks`, `create_task`, `update_task`, `create_subtask`, `manage_labels`, `analyze_workload`, `search`, `get_activity`.

**CI/CD adapters** (`services/cicd_adapters.py`): auto-detects CI/CD provider from request headers (GitHub, GitLab, Jenkins, Drone, Bitbucket) and normalizes payloads to a common format. Used by `webhooks.py` for inbound callbacks.

**MCP Server** (`mcp_server/server.py`): proxies all operations through `/api/v1` via httpx (see ADR-0005). Supports stdio and Streamable HTTP transport. Provides 15 tools, 4 resources, 1 resource template, and 4 prompts.

## Frontend architecture (`frontend/src/`)

**Styling**: dark theme, all inline styles (no CSS modules or Tailwind). Background `#07080f`, sidebar `#03040a`. Brand color `#818cf8` (indigo). Animations defined in `GLOBAL_CSS` string in `App.jsx`.

**State management**: React Query for all server state. Query keys: `['projects']`, `['project', projectId]`, `['integrations']`, `['deliveries', integrationId]`, `['workflow-rules']`, `['assistant-conversations']`, `['assistant-conv', convId]`. Mutations call `qc.invalidateQueries()` on success.

**API layer**: `src/api/client.js` — all backend calls go through an axios instance with auth header injection. The `getShareData` function uses a plain `axios` instance (no auth interceptor) for public share endpoints.

**Vite proxy** (`vite.config.js`): all backend paths listed in both `server.proxy` and the `isProxied` array in the SPA fallback middleware. When adding new backend routes, update **both** places.

**Real-time sync**: `hooks/useRealtimeSync.js` — connects to `/ws` WebSocket, auto-reconnects on disconnect (3s delay), invalidates `['projects']` and `['project', id]` queries on `task.*` and `project.*` events.

**`IssueRow.jsx`**: orchestrator component. Renders a task row with inline edit, comments panel, dependencies panel, and recurrence panel. Subtasks are rendered recursively with `depth + 1`. Sub-components: `TaskIcons.jsx`, `TaskEditForm.jsx`, `CommentsPanel.jsx`, `DependenciesPanel.jsx`, `RecurrencePanel.jsx`, `AttachmentsPanel.jsx`.

**`ProjectDetail.jsx`**: loads full project (tasks + labels + cycles), supports board/table/gantt/calendar views, client-side search filter on task title. Features: bulk actions (multi-select status/priority/pin), saved filter views, JSON import/export, board WIP limits.

**Keyboard shortcuts** (`hooks/useKeyboardShortcuts.js` + `components/KeyboardShortcutsHelp.jsx`): global single-key (`c`, `n`, `/`, `?`) and chord (`g→h`, `g→a`, `g→i`, `g→g`) shortcuts. `?` toggles the help modal.

**Offline support** (`hooks/useOfflineSync.js` + `components/OfflineIndicator.jsx`): IndexedDB queue for pending mutations when offline. Auto-syncs when reconnected. Bottom-center indicator shows offline status and pending count.

## Data flows

**Inbound CI/CD callback:**
```
POST /webhook/callback/{task.callback_token}
  -> task.status updated -> log_activity()
  -> fire_notifications() -> WebhookDelivery logged
  -> if all tasks done -> fire "project.complete" too
  -> run_rules() called for status_changed trigger
```

**External API** (`/api/v1`): requires `X-API-Key` header. Auth middleware is bypassed for `/api/v1/` — API key is the sole auth mechanism. Scopes: `read`, `write`, `admin`.

**LLM assistant flow:**
```
POST /assistant/conversations/{id}/messages
  -> SSE stream: text chunks, tool_start, tool_result, done
  -> dispatch_tool() executes DB operations directly
  -> saves AssistantMessage after done event
```
