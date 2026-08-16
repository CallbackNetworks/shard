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
# Remote MCP needs no extra service: the backend serves /mcp when MCP_HTTP_TOKEN is set (ADR-0080).
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
| `MCP_HTTP_TOKEN` | Bearer token for `/mcp`. Also the switch: **no token, no route** (ADR-0080). Standalone, the server refuses to start without one (ADR-0076) |
| `MCP_API_KEY` | API key the MCP tools act with against `/api/v1`. Its scope is what bounds the endpoint |
| `MCP_API_BASE_URL` | Where those tools send their calls (default `http://localhost:8000` — this same process) |
| `MCP_TRANSPORT` | Only for the standalone entry point (`python -m app.mcp_server.server`): `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | Port for the standalone HTTP transport (default `8001`) |

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

Config in `frontend/eslint.config.js` (flat config). CI allows up to 10 warnings (`--max-warnings 10`).

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

Alembic uses `render_as_batch=True` for SQLite compatibility. All new schema changes go through Alembic.

**Who applies migrations** (`app/db_schema.py`, ADR-0064): one module holds the decision, and it recognises three states, not two. `FRESH` (no `nodes` table) is left to the app — the lifespan runs `create_all()` and *stamps* head, because the root revision is a no-op baseline and replaying the chain would `ALTER` tables nothing created. `MANAGED` (has `alembic_version`) is *upgraded*. `UNTRACKED` (tables but no `alembic_version`) refuses and exits non-zero rather than guess.

The upgrade runs as a deploy step (`python -m app.db_schema`) after `pull` and before `up -d`, not in the lifespan: the lifespan runs once per uvicorn worker and concurrent upgrades would apply the same revisions twice. That step is why production's schema tracks the code at all — before ADR-0064 nothing ran `upgrade` anywhere, and prod carried its original schema across every deploy.

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

**`enrich_task(task, db=None)`** in `services/enrichment.py`: the single aggregation point for `TaskOut`. Computes `labels`, `subtask_count`, `comment_count`, `blocked_by[]`, `blocking[]`, and `recurrence`. Always pass `db` when recurrence data is needed. Called by `enrich_project(project, db)` which also computes progress, cycle stats, and identities.

**Container aggregation is subtree-shaped** (`graph.container_subtree_stats`, ADR-0065): a `contains` child may be a task *or* another container, so `progress` / `total_tasks` / `done_tasks` roll up the whole subtree (top-level tasks only, so a parent task and its subtasks count once). `direct_task_count` uses the same rule, so `total - direct` is the work living one level down. `goal_subtree_progress` is an alias for it. The two halves of a container's children have one endpoint each: `GET /api/nodes/{id}/contained-tasks` (its board) and `GET /api/nodes/{id}/subtree` (its child containers, each with its own rollup) — the frontend never re-derives a rollup from the tasks on screen.

**A project's size has one definition** (ADR-0068): top-level tasks in its whole `contains` subtree. Every surface that *reports* a size reads it — project/container/goal pages, internal + v1 search, the public share page, `/api/v1` project reads and `stats`/`summary`, identity hub stats, notification payloads, the daily/weekly emails and the assistant summary — via `graph.subtree_task_ids/subtree_task_views(..., top_level_only=True)` or `container_subtree_stats`. Membership checks ("is this task in this project?") stay on `contained_task_ids`: they ask about one edge. Task *listings* keep their own policy (v1 `summary` still lists subtasks as actionable work); only the counts are pinned. `tests/test_progress_agreement.py` asks every one of those surfaces the same question and fails if any answer differs.

**`log_activity(db, action, *, project_id, task_id, actor, detail, meta)`** in `services/activity.py`: call after every meaningful mutation; does `db.flush()` not `db.commit()`.

**`fire_notifications(db, task, event)`** in `services/notifier.py`: sends to all matching active integrations. Webhook-type integrations get HMAC-SHA256 `X-Signature`/`X-Hub-Signature-256` headers; email integrations use SMTP. Creates a `WebhookDelivery` log row per attempt with retry backoff `[1, 5, 30, 120, 360]` minutes.

**Credentials never leave the server**: `services/node_data.py` covers `Node.data` (ADR-0059), `services/integration_data.py` covers an integration's `secret` / `auth_config` / `custom_headers` (ADR-0063). A stored-but-withheld value reads as `null` with its key still present, and `null` on the way in means "unchanged" — so a client can GET, edit one field and PATCH back without destroying a credential it was never shown. `""` clears it; an omitted key removes it. The merge lives in the router, not in the form.

**A type declares which of its `data` keys are the user's** (ADR-0074): `node_types.fields` is a list of `{key, label, kind, store}` specs — `store` is `data` (default) or `column`, and a column field must name one of `graph.WRITABLE_COLUMNS` or it would be written into `data` under the same name and look saved while the column never changed, seeded for built-ins in `services/graph_registry.py` beside `roles` and backfilled by the migration (the seed only inserts *missing* types, so it would skip every existing database). `data` otherwise mixes three unrelated things — user fields, feature machinery (`share_token`, `callback_token`, `reminder_sent_at`, …) and ad-hoc keys somebody wrote once — which is why no generic editor existed and each built-in grew its own page. `MANAGED_DATA_KEYS` in the same module lists what may never be declared editable; declaring one, or an unknown `kind`, is a 422. `components/NodeFieldsPanel.jsx` is the one editor drawn from the declaration — it knows nothing about identity or project — mounted on `/n/{id}`. It sorts `data` into three: declared keys get a widget, keys in `MANAGED_DATA_KEYS` are hidden (their own panels show them), and anything left is listed read-only so ad-hoc keys are not visible to API callers alone. The managed list is served at `GET /api/graph-types/data-keys/managed`, never mirrored in the client.

**A credential is not writable through the generic node bag** (ADR-0074): `_NodeDataWriteGuard` on `NodeCreate`/`NodeUpdate` refuses `share_token` / `share_pin_hash` / `callback_token` / `webhook_secret` arriving either in `data` or as a top-level extra (both fold into `node.data`), and strips `share_pin_set` so a client that GETs a node and PATCHes it back cannot persist a derived key. ADR-0059 closed the read direction and left this one open — setting a signing secret to a value you chose is worth as much as reading it. The endpoints that own each credential still set it.

**A relation declares what may sit at each end** (ADR-0078): `edge_types` carries `description` + `allowed_source`/`allowed_target` (`{"types": [...], "roles": [...]}`, either key matches, `NULL` = unconstrained), seeded in `services/graph_registry.py` beside the node declarations and backfilled by migration. `graph.add_edge` enforces them next to the cycle check, so internal writes, `/api/nodes/{id}/edges` and `/api/v1/nodes/{id}/edges` are covered once — both routers already turn its `ValueError` into a 400. The refusal names the relation that *would* accept those endpoints (`identity -> project is not valid for 'contains' … use 'owns' instead`), which is the part that actually teaches an agent. `contains` carries no allow-list: it is bound by the containment rule — a source type that declares roles must hold `container` or `task`, while a type declaring **no** roles stays generic and nests freely (the free-form graph the node explorer exposes; a stricter first draft broke it). Two axes, never merged: `contains` is *where a node lives* and drives every rollup, `owns` (identity → container, renamed from the backwards-reading `member_of`) is *whose it is*. `assigned_to` was retired — declared, zero rows, never written by any code path. The vocabulary reaches agents through `GET /api/v1/edge-types` and the generated `conventions.relations` of `agent-context`; `tests/test_edge_semantics.py` asserts every edge in the database satisfies its own declaration.

**A layer can be created through the API** (ADR-0079): the node-type registry has two doors — the SPA's `/api/graph-types/nodes` and `/api/v1/node-types` (read = `read` scope, write = `admin`, because a type is the shape other data is stored in). Before this, a custom layer could be created from the UI and by nothing else, and `/api/v1` never said which `type` values were legal even though every node write requires one. The guards (built-in undeletable, built-in `container`/`task` roles frozen, in-use types undeletable, duplicate key 409) live once in `services/graph_registry.py` and raise `TypeRegistryError`, which each router translates to HTTP; `tests/test_node_type_api.py` sends the *same* request to both doors and asserts the status and detail match. `conventions.node_types` joins `conventions.relations` in `agent-context`. Edge types stay read-only on purpose: a relation created without endpoint declarations is what ADR-0078 closed.

**Sharing has one *write* implementation too** (`services/share_admin.py`, ADR-0087): the v1 share facade was written fresh alongside the internal one, minting its own token from its own `uuid4()`. Nothing had broken — the state ADR-0070 warns about, since a duplicate that still works has no failure symptom. Collapsing them surfaced a live defect: `POST /api/v1/nodes/{id}/share/rotate-token` with a `write` key returned `200 {}` — the rotation happened, the live link broke, and the redaction middleware had removed the only field naming the new one. It now requires `admin` (the token *is* the public URL); the other share writes return `{"ok": true}`, carry no capability and stay `write`. `tests/test_share_write_parity.py` asserts at the *output boundary* — that a share configured through either door behaves identically on the public page — because "both doors return 200" is exactly what a drifted duplicate also does.

**Sharing has one implementation, for every shareable type** (ADR-0070 → ADR-0073). One panel: `components/NodeShareFacet.jsx`, used by identity, project and custom containers alike — it reads share state from either shape it is handed (a raw `Node` keeps it under `data`, an enriched `IdentityOut`/`ProjectOut` flattens it) and takes `invalidateKeys` for callers holding the node under another query key. One public page `/share/n/{token}` fed by one data endpoint `GET /share/node/{token}` (+ `/verify`, `/notes`), all dispatching on the token's node type. One calendar feed `/ical/node/{token}.ics`. One write surface `/api/nodes/{id}/share/*` (token, PIN, expiry, guest notes). One view count, `services.activity.share_view_count` — it matches `share.viewed` rows under any of `identity_id` / `project_id` / `node_id`, because rows written before the doors collapsed name their subject differently; retiring a route must not retire its history.

**The page and the call it makes are different paths on purpose**: the page is `/share/n/{token}`, the data is `/share/node/{token}` — same URL for both and the SPA answers its own fetch with `index.html` (ADR-0071). Any new root-level client call must be added to `frontend/backendPaths.js` *and* `nginx.conf`; `backendPathClaims.test.js` checks both directions. A PIN is enforced on every shareable type including projects (ADR-0072), and the guest-note gate uses the same hash so it cannot be a way around the page gate.

**`run_rules(db, trigger, node, context)`** in `services/rules_engine.py`: evaluates active `WorkflowRule` rows. Triggers are graph-shaped, not task-shaped (ADR-0049, ADR-0055): `node.created`, `node.updated`, `node.deleted`, `edge.added`, `edge.removed`. Called from `services/task_mutations.py` (task writes) and `services/graph_dispatch.py` (every other node/edge write); `context` carries what changed (`changed`, `edge_type`, `edge_side`, `other_type`) so conditions can match the change, not just the subject. Rules never chain: every write a rule makes goes back through the same pipeline with `trigger_rules=False` (ADR-0048).

**Scheduler** (`services/scheduler.py`): asyncio loop, ticks every 3600 s. `_run_tick` runs seven checks, each isolated in its own try/except so one failure cannot starve the rest: due-date reminders (`task.due_soon`/`task.overdue`), recurring task generation, failed webhook retries, daily summary email (once per day at `SUMMARY_HOUR` UTC to all email-type integrations), weekly digest (`DIGEST_DAY`), SLA aging, and the daily backup.

**LLM assistant** (`services/llm.py` + `services/assistant_tools.py`): provider-agnostic. `get_provider()` reads `LLM_PROVIDER` env var and returns `ClaudeProvider`, `OpenAIProvider`, or `StubProvider`. Tools: `get_summary`, `list_tasks`, `create_task`, `update_task`, `create_subtask`, `manage_labels`, `analyze_workload`, `search`, `get_activity`.

**CI/CD adapters** (`services/cicd_adapters.py`): auto-detects CI/CD provider from request headers (GitHub, GitLab, Jenkins, Drone, Bitbucket) and normalizes payloads to a common format. Used by `webhooks.py` for inbound callbacks.

**MCP Server** (`backend/app/mcp_server/server.py`): a module inside the backend package, not a separate build (ADR-0080) — the standalone container was a requirement of the stdio era, and remote HTTP (ADR-0076) retired it. Both entry points run the same module: `python -m app.mcp_server.server` for stdio (the client owns the process), `MCP_TRANSPORT=http` for the HTTP transport. It proxies all operations through `/api/v1` via httpx (see ADR-0005) — co-locating processes is a deployment decision, not a data-path one, and the API key's scope is what bounds the public endpoint. Provides 34 tools, 4 resources, 1 resource template, and 4 prompts — all declared with `MCPServer` decorators on `mcp` SDK 2.0, so a tool's **signature is its schema** (ADR-0077). There is no hand-written `inputSchema` and no `if name == ...` dispatch to keep in step; the thin decorated wrappers sit on top of the `_`-prefixed implementations, which are what the test suite mocks httpx against. A missing argument, an out-of-enum value or a failing tool is a protocol error, not a successful result whose text says "error".

**Remote MCP is a route on the backend, behind the frontend's nginx** (ADR-0076 → ADR-0080): production exposes it at `https://<host>/mcp`, proxied to `backend:8000` — one door, no extra container. `main.py` registers the route **iff `MCP_HTTP_TOKEN` is set**, and its lifespan enters the transport's; a half-configured public endpoint is not a state worth serving, so the path is *absent* (404) rather than present-but-empty (502). Three shapes are load-bearing and each has a test that fails if undone: the endpoint is a **class** (`Route` calls a *function* as `func(request) -> response`, and the session manager writes its own response); the **host must enter `HttpTransport.lifespan()`** (a route endpoint never sees a lifespan scope, and skipping it fails at request time, not startup); and the transport app is **built per startup** (the SDK's session manager may be run once per instance). `/mcp` is in `frontend/backendPaths.js` so the SPA never answers an MCP client with `index.html`.

## Frontend architecture (`frontend/src/`)

**Styling** (see ADR-0012): dark theme, no Tailwind or CSS-in-JS. Three layers: `src/styles/global.css` (tokens, keyframes, shared utilities), co-located CSS Modules (`Component.module.css`, imported as `s`) for component-scoped static styles, and inline `style={{...}}` only for dynamic values or legacy code. When significantly editing a component, migrate its static inline styles to a CSS Module. The runtime accent is amber (`--accent`, user-switchable in Settings).

**A colour means one thing** (ADR-0088): three families, no shared hue — `--accent` (brand), `--kt-status-*` (the state machine: grey / blue / green / red), `--kt-prio-*` (urgency). Amber was all three at once, so one yellow in a task row meant "in progress", "high priority" and "button" indistinguishably. Every family is declared in **both** `:root` and `[data-theme="light"]`; `constants/theme.js` resolves through them with a dark-mode literal fallback, which is also how the SVG charts consume them (`var()` *does* resolve in an SVG presentation attribute). That makes `color + '33'` unusable — appending hex alpha to `var(...)` yields a value the browser drops silently — so use `alpha()` from `utils/color.js`. Priority is ordinal: only `high` carries colour, and `weight` (solid/outline/ghost) plus the ▲■▼ glyph carry the order without it. One `PriorityChip` in `TaskIcons.jsx`, no hand-rolled copies.

**The rail's width and the gutter reserved for it are one variable** (`--rail-w`, ADR-0088): the rail used to expand on hover while `position: fixed` over a 72px gutter, so approaching the left edge covered the first 150px of the page — and its labels were *only* reachable by that hover. Expansion is now the persisted `railExpanded` UI pref, published as `data-rail` by `applyUiPrefs`. Anything fixed to the left edge (`.kt-mini-drawer`, `.kt-signal-timeline`) reads `--rail-w`, never a literal.

**Every surface that shows prose is translatable** (`src/__tests__/i18nCoverage.test.js`, ADR-0088): one test asserts each page/component calls the translator, another that `en.json` and `zh-TW.json` describe the same app. `test/setup.js` initialises the real i18n singleton — without it `t` returns the key, so a test asserting the text a user sees passes only while the component is *untranslated*, which is how `ProjectDetail` stayed hardcoded English behind a fully translated rail. `Container` stays the user-facing word: it is the API's own role name (ADR-0058).

**State management**: React Query for all server state. Query keys: `['projects']`, `['project', projectId]`, `['integrations']`, `['deliveries', integrationId]`, `['workflow-rules']`, `['assistant-conversations']`, `['assistant-conv', convId]`. Mutations call `qc.invalidateQueries()` on success.

**API layer**: `src/api/client.js` — all backend calls go through an axios instance whose `baseURL` is `/api` (ADR-0036) with auth header injection. The internal API is namespaced under `/api` so backend paths never collide with SPA page routes. The `getShareData`/share-note functions use a plain `axios` instance (no auth interceptor, no `/api` baseURL) for public share endpoints, which stay at root.

**Internal API is under `/api`** (ADR-0036): `main.py` mounts all SPA-consumed routers under an `APIRouter(prefix="/api")`. Root-level paths are external contracts only: `/api/v1` (external API), `/webhook`, `/share`, `/ical`, `/ws`, `/health`, `/docs`. Adding a new SPA-facing router needs no proxy/config change — it's automatically under `/api`. Both `vite.config.js` (`server.proxy` + `isProxied`) and `frontend/nginx.conf` (prod reverse-proxy) already route all of `/api` to the backend; only a *new external/root* route requires touching those two files.

**Structure map draws the container hierarchy** (`utils/containerTree.js`, ADR-0069): all four styles ask `buildContainerForest` for the same shape and differ only in how they draw it — tree nests recursively (a child container takes the row below its parent), sankey orders rows depth-first and indents per level, territory draws a child container *inside* its parent's card, network keeps its links. Parenting resolves within the *visible* set, so a filtered-out parent promotes its children to roots instead of hiding them. The map's own derived card numbers follow the ADR-0068 size rule (subtree, top-level tasks) plus `directTaskCount`, so a card never disagrees with the project page.

**Real-time sync**: `hooks/useRealtimeSync.js` — connects to `/ws` WebSocket, auto-reconnects on disconnect (3s delay), invalidates `['projects']` and `['project', id]` queries on `task.*` and `project.*` events.

**`IssueRow.jsx`**: orchestrator component. Renders a task row with inline edit, comments panel, dependencies panel, and recurrence panel. Subtasks are rendered recursively with `depth + 1`. Sub-components: `TaskIcons.jsx`, `TaskEditForm.jsx`, `CommentsPanel.jsx`, `DependenciesPanel.jsx`, `RecurrencePanel.jsx`, `AttachmentsPanel.jsx`.

**`ProjectDetail.jsx`**: loads full project (tasks + labels + cycles), supports board/table/gantt/calendar views, client-side search filter on task title. Features: bulk actions (multi-select status/priority/pin), saved filter views, JSON import/export, board WIP limits.

**Keyboard shortcuts** (`hooks/useKeyboardShortcuts.js` + `components/KeyboardShortcutsHelp.jsx`): global single-key (`c`, `n`, `/`, `?`) and chord (`g→h`, `g→a`, `g→i`, `g→g`, `g→p`) shortcuts. `?` toggles the help modal. `g→p` opens the palette instead of navigating — which project you want is a choice, not a fixed destination.

**Project switching lives in the palette, not the rail** (`components/CommandPalette.jsx`, ADR-0067): `mode='projects'` makes it a switcher — projects only, most-recently-visited first (`utils/recentProjects.js`, ids only, localStorage, not cross-device), and it omits the project you are currently in so `g→p`+Enter is always alt-tab. Both modes apply `filterProjects` from the identity focus, including to search-API hits.

**Offline support** (`api/offlineQueue.js` + `hooks/useOfflineSync.js` + `components/OfflineIndicator.jsx`): IndexedDB queue for pending mutations when offline. The producer is the axios response interceptor in `api/client.js` — every write passes through it, so no per-mutation wiring is needed (ADR-0062). `FormData` uploads are not queued. `useOfflineSync` drains the queue through the same axios instance on reconnect, in insertion order, dropping actions the server refuses with a 4xx. Bottom-center indicator shows offline status and pending count.

**Every rail row is a declared module** (`components/Sidebar.jsx`, ADR-0066): the sidebar's height must not be a function of the data. A collection whose size the user controls never gets one rail row per element — identity focus is *one control with N values*, so it collapses into `FocusSwitcher` (one row, searchable popover, "no focus" is the first option); custom container types are real destinations but unbounded, so the rail carries one fixed `/containers` entry and the list lives on the page. The rail is a 5-row grid (brand / search / focus / modules / actions) and **only the module row scrolls**.

**Backend paths vs page routes** (`frontend/backendPaths.js`): the one list of URL prefixes that belong to the backend, matched by whole path segment. Both the Vite dev proxy and `frontend/nginx.conf` follow it; `src/__tests__/backendPathClaims.test.js` asserts no SPA route in `App.jsx` is claimed by either (ADR-0036, ADR-0061).

## Data flows

**A capability is not browser-only** (ADR-0084 → ADR-0085): anything reachable only through the internal `/api` is, in production, reachable only by a person in a browser — `AUTH_PASSWORD` gates it and an API key cannot present one. Five capabilities were in that state and now have a second door, each as one service both routers call: `webhook_credentials` (inbound CI/CD credentials + build history), `cicd_dispatch` (start a pipeline), `integration_admin` (outbound targets — `/api/v1/subscriptions` is this with the type, name and credentials nailed shut), `delivery_admin` (the delivery log; a webhook's failure mode is silence), `rule_admin` (the whole rules engine — an agent could perform every write forever and never automate one). Scopes follow the existing precedent rather than inventing a stricter one: integrations and rules take `write` because `/subscriptions` always did for the same objects; the ADR-0084 credential reveal takes `admin` because the v1 redaction middleware would strip `callback_token` from a lesser key's response and hand back a config with the address silently missing.

**A service-layer refusal is rendered once** (`services/errors.py`, ADR-0085): a service raises `ServiceError(status, detail)` and one `main.py` handler renders it, so the internal and v1 doors onto one act cannot answer a refusal differently — neither router writes one. `HTTPException` cannot do this (it is a FastAPI concept, so the refusal moves back into the routers, written twice); a bare `ValueError` cannot either (each router re-decides the status). `tests/test_agent_surface_parity.py` sends the same request through both doors and compares status *and* detail text.

**Nothing is unauthenticated by accident** (`tests/test_unauthenticated_surface.py`, ADR-0085): `_AUTH_BYPASS` exempts path *prefixes*, so an endpoint added next to one that earned its exemption inherits it. `GET /webhook/events/{task_id}` did exactly that and was readable off production by anyone holding a node id; it is now `GET /api/nodes/{id}/webhook-events` (+ its v1 twin), and `/webhook/` carries only what a runner POSTs to. The guard enumerates `app.openapi()` and fails on any credential-free route not named in a list beside its reason. Its companion `frontend/src/api/__tests__/clientPathPrefix.test.js` pins the other half: the axios instance has `baseURL: '/api'`, so handing it a root-level path (`/webhook`, `/share`, `/ical`) builds a URL that matches nothing — which is why the build-history panel had never once loaded.

**A field you can read is a field you can write** (ADR-0086): three read/write asymmetries are closed — `recurrence` rode on every `TaskOut` with no v1 write path, a cycle could be *written into* (`in_cycle` is an edge) and never read, and an agent's output files had nowhere to go. Plus the planning half of analytics (critical path, burn-down, calibrated estimates), templates, the export/import round trip, notification clearing, and edge-type writes — which ADR-0079 left read-only on v1 for a reason that does not hold: the internal door could always create a relation with both endpoint declarations NULL, so the restriction never prevented the bad state, only agents reaching a state the UI reaches in two clicks. Services: `recurrence_admin`, `attachment_admin`, `cycle_admin`, `analytics_admin`, `task_transfer`, plus edge-type guards moved into `graph_registry`. Attachments have two upload doors (multipart for the SPA, base64 JSON for callers that cannot build multipart) landing in one `store`, so the size limit exists once.

**`/api/v1/tools-schema` is generated, not written** (ADR-0086): it projects `mcp.list_tools()` into OpenAI function-calling shape. It used to be a hand-maintained list beside the MCP registry describing the same operations, and it had drifted by a dozen tools. ADR-0077 already made the MCP registry the single source; this reads from it. `test_agent_surface_gaps.py` asserts the two sets are *equal*.

**A literal path segment must be registered before the parameterised one** (ADR-0086): `/api/v1/projects/{id}/tasks/export` was unreachable — `/projects/{id}/tasks/{task_id}` matched first with `task_id="export"`. Routing is first-match and neither declaration reveals the conflict; only the include order in `external_api/__init__.py` does. `TestALiteralPathIsNotSwallowedByAParameter` sweeps the v1 route table for same-method shadows.

**A delivery log is a second path out for a credential** (`services/delivery_admin.py`, ADR-0085): `request_headers` redacted only `authorization`, which was right when bearer was the only auth type. An `api_key` integration puts its key in a user-named header and `custom_headers` is free-form, so ADR-0063's withholding was defeated by the log. The secret header names are derived from the integration, and the redaction is applied on read as well as write — a log is written once and read forever.

**Inbound CI/CD callback:**
```
POST /webhook/callback/{task.callback_token}
  -> WebhookEvent row logged (build history), always
  -> unrecognised status -> log "webhook.unmapped_status", task left unchanged (ADR-0051)
  -> otherwise apply_task_update(status, source="webhook", sync_external=False)
       -> log_activity()
       -> fire_notifications() -> WebhookDelivery logged
       -> if all tasks done -> fire "project.complete" too
       -> run_rules("node.updated", context={"changed": [...]})
```

**External API** (`/api/v1`): requires `X-API-Key` header. Auth middleware is bypassed for `/api/v1/` — API key is the sole auth mechanism. Scopes: `read`, `write`, `admin`.

**LLM assistant flow:**
```
POST /assistant/conversations/{id}/messages
  -> SSE stream: text chunks, tool_start, tool_result, done
  -> dispatch_tool() executes DB operations directly
  -> saves AssistantMessage after done event
```
