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
| `AUTH_PASSWORD` | Built-in shared-password gate for `/app`; leave empty for no auth |
| `AUTH_TOKEN_TTL` | Session token lifetime in seconds (default `604800`, 7 days) |
| `AUTH_MAX_ATTEMPTS` | Failed logins per IP before lockout (default `5`) |
| `AUTH_LOCKOUT_SECONDS` | Login lockout window in seconds (default `300`) |
| `AUTH_PROXY_HEADER` | Forward-auth: trust this header from an upstream SSO proxy (e.g. `Cf-Access-Authenticated-User-Email`). Only safe when the origin is reachable exclusively via that proxy — see ADR-0030 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_USE_TLS` | Email notifications |
| `LLM_PROVIDER` | `claude` \| `openai` \| `stub` (default `stub`) |
| `LLM_API_KEY` | API key for the chosen LLM provider |
| `LLM_MODEL` | Model name (e.g. `claude-sonnet-4-6` for Claude, `gpt-4o` for OpenAI) |
| `SUMMARY_HOUR` | Hour (UTC) to send daily summary email (default `8`) |
| `BACKUP_ENABLED` | Automatic daily backup on/off (default `1`; runtime-adjustable) |
| `BACKUP_HOUR` | Hour (UTC) for the daily backup (default `3`; runtime-adjustable) |
| `BACKUP_KEEP` | How many backup archives to retain (default `7`; runtime-adjustable) |
| `BACKUP_DIR` | Where backup archives are written (default `/app/data/backups`) |
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

**SQLite and PostgreSQL are equal, parallel test targets.** `conftest.py` reads `TEST_DATABASE_URL` (default `sqlite:///:memory:` via `StaticPool`); point it at PostgreSQL to run the identical suite there. `scripts/test.sh` wraps both (dev stack must be up):

```bash
scripts/test.sh              # both databases (default)
scripts/test.sh sqlite       # SQLite only
scripts/test.sh postgres     # PostgreSQL only (isolated shard_test DB, never app data)
scripts/test.sh both -k foo  # extra args after the target pass through to pytest
```

`conftest.py` provides `db`, `client`, `sample_identity`, and `sample_project` fixtures. Auth middleware is disabled in tests (`AUTH_PASSWORD=""`). Both databases enforce `--cov-fail-under=78` in CI. Some tests are dialect-aware (e.g. skip under enforced foreign keys) — see ADR-0018.

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

## CI/CD pipeline (`.github/workflows/ci.yml`)

Runs on push/PR to `main`. Seven jobs:
1. **Backend checks**: ruff lint + format check, pip-audit (DB-independent, runs once)
2. **Backend tests (SQLite)**: pytest with coverage (>=78%) against SQLite
3. **Backend tests (PostgreSQL)**: the same suite with the same coverage gate against a `postgres:16-alpine` service (`pgtest` profile in `docker-compose.ci.yml`). SQLite and PostgreSQL are co-equal, symmetric targets — neither is primary; both gate deploy (see ADR-0018, ADR-0020)
4. **Frontend**: ESLint, vitest, npm audit, vite build
5. **Integration**: production compose up, backend health check, frontend smoke test (needs backend-checks + backend-sqlite + backend-postgres + frontend)
6. **Publish**: build and push Docker images to registry (main branch only)
7. **Deploy**: pull images on `cd-deployer`, generate compose file at `$DEPLOY_DIR` (configurable via `vars.DEPLOY_DIR`, defaults to `~/deployments/<repo-name>`), bring services up with health checks (main branch only). Requires `.env` pre-configured in the deploy directory.

## Schema migrations (Alembic)

```bash
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'description'"
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

Alembic uses `render_as_batch=True` for SQLite compatibility. On a fresh database the lifespan runs `Base.metadata.create_all()` and stamps the Alembic chain to `head` (see `_stamp_alembic_head` in `main.py` and ADR-0018); on an existing database, run `alembic upgrade head` for schema changes. All new schema changes go through Alembic.

## Backend architecture (`backend/app/`)

**Entry point: `main.py`**
- Registers all routers
- `lifespan` context: runs `Base.metadata.create_all()` and stamps a fresh database to the Alembic head, then starts the background scheduler as an `asyncio.Task`
- Auth middleware gates the human UI when `AUTH_PASSWORD` or `AUTH_PROXY_HEADER` is set (see ADR-0030); bypasses `/auth/`, `/health`, `/webhook/`, `/share/`, `/ical/`, `/ws`, `/docs`, `/openapi.json`, `/redoc`, `/api/v1/`. Password tokens expire (`AUTH_TOKEN_TTL`) and logins are IP-throttled; forward-auth trusts an upstream SSO proxy's identity header

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

**Styling** (see ADR-0012): dark theme, no Tailwind or CSS-in-JS. Three layers: `src/styles/global.css` (tokens, keyframes, shared utilities), co-located CSS Modules (`Component.module.css`, imported as `s`) for component-scoped static styles, and inline `style={{...}}` only for dynamic values or legacy code. When significantly editing a component, migrate its static inline styles to a CSS Module. Background `#07080f`, sidebar `#03040a`. Brand color `#818cf8` (indigo).

**State management**: React Query for all server state. Query keys: `['projects']`, `['project', projectId]`, `['integrations']`, `['deliveries', integrationId]`, `['workflow-rules']`, `['assistant-conversations']`, `['assistant-conv', convId]`. Mutations call `qc.invalidateQueries()` on success.

**API layer**: `src/api/client.js` — all backend calls go through an axios instance whose `baseURL` is `/api` (ADR-0036) with auth header injection. The internal API is namespaced under `/api` so backend paths never collide with SPA page routes. The `getShareData`/share-note functions use a plain `axios` instance (no auth interceptor, no `/api` baseURL) for public share endpoints, which stay at root.

**Internal API is under `/api`** (ADR-0036): `main.py` mounts all SPA-consumed routers under an `APIRouter(prefix="/api")`. Root-level paths are external contracts only: `/api/v1` (external API), `/webhook`, `/share`, `/ical`, `/ws`, `/health`, `/docs`. Adding a new SPA-facing router needs no proxy/config change — it's automatically under `/api`. Both `vite.config.js` (`server.proxy` + `isProxied`) and `frontend/nginx.conf` (prod reverse-proxy) already route all of `/api` to the backend; only a *new external/root* route requires touching those two files.

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
