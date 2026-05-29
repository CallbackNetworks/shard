# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source location

The **actual editable source** is at `/home/chungchen/20260318/`. The directory `/home/chungchen/todo-plateform/` only contains `__pycache__` — never edit files there.

## Environment

All services run in Docker with hot-reload. **Never install Python packages or Node modules on the host.**

```bash
docker compose up --build   # first run or after changing requirements.txt / package.json
docker compose up           # subsequent runs (hot-reload active)
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

### Environment variables (`.env` in project root)

| Variable | Purpose |
|----------|---------|
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

## Backend architecture (`backend/app/`)

**Entry point: `main.py`**
- Registers all routers
- `lifespan` context: runs `Base.metadata.create_all()` + `ALTER TABLE` migrations for columns added after initial schema, then starts the background scheduler as an `asyncio.Task`
- Auth middleware reads `AUTH_PASSWORD`; bypasses `/auth/`, `/health`, `/webhook/`, `/share/`, `/docs`, `/openapi.json`, `/redoc`, `/api/v1/`

**Data layer**
- `models.py` — all SQLAlchemy ORM models (SQLite)
- `schemas.py` — all Pydantic v2 request/response types
- `database.py` — `SessionLocal`, `Base`, `get_db` dependency

**Current models** (all in `models.py`):
`Project`, `Task`, `Label`, `TaskLabel`, `Cycle`, `CycleTask`, `Integration`, `Identity`, `ProjectIdentity`, `ActivityLog`, `ApiKey`, `Comment`, `TaskDependency`, `RecurrenceRule`, `WebhookDelivery`, `AssistantConversation`, `AssistantMessage`, `WorkflowRule`, `Attachment`, `TaskTemplate`

**Schema migrations**: Alembic is set up with `render_as_batch=True` for SQLite compatibility. Migration scripts are in `backend/migrations/versions/`. Legacy `ALTER TABLE` blocks remain in `main.py` lifespan for backward compat. For **new** schema changes, use Alembic:
```bash
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'description'"
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

### Routers

| Router | Prefix | Notes |
|--------|--------|-------|
| `projects.py` | `/projects` | CRUD; progress computed on read via `_enrich()` |
| `tasks.py` | `/projects/{id}/tasks` | async endpoints; calls `run_rules()` on create/update |
| `labels.py` + `task_label_router` | `/projects/{id}/labels`, `/projects/{id}/tasks/{tid}/labels` | |
| `cycles.py` | `/projects/{id}/cycles` | Sprint management |
| `comments.py` | `/projects/{id}/tasks/{tid}/comments` | |
| `recurring.py` | `/projects/{id}/tasks/{tid}/recurrence` | GET/POST/PATCH/DELETE |
| `webhooks.py` | `/webhook/callback/{token}` | Inbound CI/CD; calls `fire_notifications()` |
| `webhook_logs.py` | `/integrations/{id}/deliveries`, `/deliveries/{id}` | Delivery logs + retry |
| `integrations.py` | `/integrations` | Outbound notification config |
| `identities.py` | `/identities` | Multi-identity + share tokens |
| `search.py` | `/search?q=&project_id=` | Tasks + projects, case-insensitive LIKE |
| `analytics.py` | `/analytics/{overview,heatmap,burndown,velocity,status-trend,cycle-burndown}` | Aggregation endpoints |
| `templates.py` | `/templates` | Task template CRUD |
| `attachments.py` | `/projects/{id}/tasks/{tid}/attachments` | File upload/download/delete |
| `workflow_rules.py` | `/workflow-rules` | CRUD + `POST /{id}/test?task_id=` dry-run |
| `assistant.py` | `/assistant/conversations` | SSE streaming chat |
| `external_api.py` | `/api/v1` | API-key-authenticated external API |
| `share.py` | `/share/identity/{token}` | Public read-only identity view |
| `activity.py` | `/activity` | Activity log |
| `api_keys.py` | `/api-keys` | API key management |
| `auth.py` | `/auth` | Login / token |
| `ws.py` | `/ws` | WebSocket real-time events |

### Key patterns

**`ws_manager`** (`services/ws_manager.py`): singleton `ConnectionManager` for WebSocket broadcast. Call `await ws_manager.broadcast(event, data)` after mutations in routers. Frontend auto-reconnects and invalidates React Query caches on events.

**`_enrich_task(task, db=None)`** in `routers/projects.py`: the single aggregation point for `TaskOut`. Computes `labels`, `subtask_count`, `comment_count`, `blocked_by[]`, `blocking[]`, and `recurrence`. Always pass `db` when recurrence data is needed. Called by `_enrich(project, db)` which also computes progress, cycle stats, and identities.

**`log_activity(db, action, *, project_id, task_id, actor, detail, meta)`** in `services/activity.py`: call after every meaningful mutation; does `db.flush()` not `db.commit()`.

**`fire_notifications(db, task, event)`** in `services/notifier.py`: sends to all matching active integrations. Webhook-type integrations get HMAC-SHA256 `X-Signature`/`X-Hub-Signature-256` headers; email integrations use SMTP. Creates a `WebhookDelivery` log row per attempt with retry backoff `[1, 5, 30, 120, 360]` minutes.

**`run_rules(db, trigger, task, context)`** in `services/rules_engine.py`: evaluates active `WorkflowRule` rows. Called from `tasks.py` after create (`task.created`) and after status/priority changes. Pass `_rule_depth=1` in context from rule-triggered updates to prevent infinite loops (max depth 2).

**Scheduler** (`services/scheduler.py`): asyncio loop, ticks every 3600 s. Runs four checks: due-date reminders (`task.due_soon`/`task.overdue`), recurring task generation, failed webhook retries, and daily summary email (sent once per day at `SUMMARY_HOUR` UTC to all email-type integrations).

**LLM assistant** (`services/llm.py` + `services/assistant_tools.py`): provider-agnostic. `get_provider()` reads `LLM_PROVIDER` env var and returns `ClaudeProvider`, `OpenAIProvider`, or `StubProvider`. Tools: `get_summary`, `list_tasks`, `create_task`, `update_task`, `create_subtask`, `manage_labels`, `analyze_workload`, `search`, `get_activity`. Frontend has prompt templates (Summary, Overdue, Workload, Recent, Plan today) shown as quick-action buttons in empty conversations.

## Frontend architecture (`frontend/src/`)

**Styling**: dark theme, all inline styles (no CSS modules or Tailwind). Background `#07080f`, sidebar `#03040a`. Brand color `#818cf8` (indigo). Animations defined in `GLOBAL_CSS` string in `App.jsx`.

**State management**: React Query for all server state. Query keys: `['projects']`, `['project', projectId]`, `['integrations']`, `['deliveries', integrationId]`, `['workflow-rules']`, `['assistant-conversations']`, `['assistant-conv', convId]`. Mutations call `qc.invalidateQueries()` on success.

**API layer**: `src/api/client.js` — all backend calls go through an axios instance with auth header injection. The `getShareData` function uses a plain `axios` instance (no auth interceptor) for public share endpoints.

**Routing** (all under `/app/*` in `Layout`):

| Route | Component |
|-------|-----------|
| `/app` | `Dashboard` |
| `/app/projects/:id` | `ProjectDetail` |
| `/app/identities` | `Identities` |
| `/app/integrations` | `Integrations` |
| `/app/api-keys` | `ApiKeys` |
| `/app/analytics` | `Analytics` |
| `/app/workflow-rules` | `WorkflowRules` |

**Global UI** (mounted in `Layout`):
- `CommandPalette` — ⌘K / Ctrl+K; fuzzy search over projects and tasks
- `AssistantPanel` — floating bottom-right button; SSE streaming chat panel

**Vite proxy** (`vite.config.js`): all backend paths listed in both `server.proxy` and the `isProxied` array in the SPA fallback middleware. When adding new backend routes, update **both** places.

**Real-time sync**: `hooks/useRealtimeSync.js` — connects to `/ws` WebSocket, auto-reconnects on disconnect (3s delay), invalidates `['projects']` and `['project', id]` queries on `task.*` and `project.*` events.

**IssueRow sub-components**: `TaskIcons.jsx` (PriorityIcon, StatusIcon, LabelChip), `TaskEditForm.jsx`, `CommentsPanel.jsx`, `DependenciesPanel.jsx`, `RecurrencePanel.jsx`, `AttachmentsPanel.jsx` — extracted from IssueRow for maintainability.

**`IssueRow.jsx`**: orchestrator component. Renders a task row with inline edit, comments panel, dependencies panel, and recurrence panel. Each panel is toggled by hover-action buttons. Subtasks are rendered recursively with `depth + 1`.

**`ProjectDetail.jsx`**: loads full project (tasks + labels + cycles), supports board/table/gantt views, client-side search filter on task title.

## Data flows

**Inbound CI/CD callback:**
```
POST /webhook/callback/{task.callback_token}
  → task.status updated → log_activity()
  → fire_notifications() → WebhookDelivery logged
  → if all tasks done → fire "project.complete" too
  → run_rules() called for status_changed trigger
```

**Outbound notification payload:**
```json
{
  "event": "task.done",
  "project": { "id", "name", "status", "progress", "total_tasks", "done_tasks" },
  "task": { "id", "title", "status", "priority" },
  "timestamp": "ISO8601"
}
```

**Webhook HMAC signing** (type `webhook` integrations): `X-Signature: sha256=<hex>` and `X-Hub-Signature-256` computed over the exact JSON bytes sent.

**External API** (`/api/v1`): requires `X-API-Key` header. Auth middleware is bypassed for `/api/v1/` — API key is the sole auth mechanism. Key endpoints for AI agents:
- `GET /api/v1/agent-context` — onboarding: capabilities, conventions, per-project instructions
- `GET /api/v1/summary` — full project/task snapshot optimized for LLMs
- `POST /api/v1/projects/{id}/tasks/{id}/progress` — report intermediate progress (0-100%)
- Scopes: `read`, `write`, `admin`

**MCP Server** (`mcp_server/server.py`): proxies all operations through `/api/v1` via httpx (see ADR-0005). Supports stdio (default) and Streamable HTTP transport (`MCP_TRANSPORT=http`). Provides 15 tools, 4 resources (`todo://summary`, `todo://activity`, `todo://notifications`, `todo://agent-context`), 1 resource template (`todo://projects/{id}`), and 4 prompts (`plan-my-day`, `project-review`, `triage-inbox`, `weekly-summary`).

**LLM assistant flow:**
```
POST /assistant/conversations/{id}/messages
  → SSE stream: text chunks, tool_start, tool_result, done
  → dispatch_tool() executes DB operations directly
  → saves AssistantMessage after done event
```
