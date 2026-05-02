# Architecture

## Overview

```
Browser
  └── Frontend (React/Vite :5173)
        ├── /app/*  →  Management UI (auth-gated)
        └── /       →  Public status page
              │
              │ Vite proxy (HTTP)
              ▼
         Backend (FastAPI :8000)
              ├── SQLite database (persisted volume)
              ├── WebSocket (/ws) for real-time sync
              └── Outbound: webhooks, SMTP, LLM providers
```

Both services run in Docker Compose with host-mounted source directories for hot-reload.

## Backend (`backend/app/`)

| File / Directory | Role |
|---|---|
| `main.py` | FastAPI app, middleware registration, router mounts, DB init, scheduler startup |
| `models.py` | SQLAlchemy ORM models |
| `schemas.py` | Pydantic request/response schemas |
| `database.py` | Engine, session factory, `Base` |
| `routers/` | Route handlers (one file per resource) |
| `services/` | Business logic called by routers |
| `migrations/` | Alembic migration scripts (batch mode for SQLite) |

### Middleware

`AuthMiddleware` (Starlette `BaseHTTPMiddleware`) runs on every request:
- If `AUTH_PASSWORD` env var is unset → passes all requests through
- Bypass paths (no auth needed): `/auth/`, `/health`, `/webhook/`, `/share/`, `/docs`, `/openapi.json`, `/redoc`
- All other paths require `Authorization: Bearer {sha256(AUTH_PASSWORD)}`
- Returns `401` JSON on failure

### Routers

| Router | Mount | Description |
|---|---|---|
| `auth` | `/auth` | Login + token verify |
| `projects` | `/projects` | Project CRUD |
| `tasks` | `/projects/{pid}/tasks` | Task CRUD; triggers workflow rules on create/update |
| `labels` | `/projects/{pid}/labels` | Label CRUD, task-label links |
| `cycles` | `/projects/{pid}/cycles` | Cycle/sprint CRUD + task assignments |
| `comments` | `/projects/{pid}/tasks/{tid}/comments` | Task comments CRUD |
| `recurring` | `/projects/{pid}/tasks/{tid}/recurrence` | Recurrence rule management |
| `attachments` | `/projects/{pid}/tasks/{tid}/attachments` | File upload/download/delete (max 20 MB) |
| `webhooks` | `/webhook` | Inbound CI/CD callbacks |
| `webhook_logs` | `/integrations/{id}/deliveries`, `/deliveries/{id}` | Delivery logs + manual retry + purge |
| `integrations` | `/integrations` | Outbound notification targets |
| `identities` | `/identities` | Identity CRUD + project links + share PIN/expiry |
| `share` | `/share` | Public read-only identity view (PIN-protected optional) |
| `api_keys` | `/api-keys` | API key management |
| `activity` | `/activity` | Activity log (read-only) |
| `search` | `/search` | Cross-resource search (tasks + projects, case-insensitive LIKE) |
| `analytics` | `/analytics` | Overview, heatmap, burndown, velocity, status trend |
| `templates` | `/templates` | Task template CRUD |
| `workflow_rules` | `/workflow-rules` | Automation rules CRUD + dry-run testing |
| `assistant` | `/assistant` | LLM chat with SSE streaming + tool use |
| `external_api` | `/api/v1` | External REST API (API key auth) |
| `ws` | `/ws` | WebSocket endpoint for real-time events |

### Services

**`notifier.py`** — fires outbound notifications after task status changes or project completion:
1. Query integrations whose `events` array contains the event type
2. For webhook integrations: async `httpx.post` with JSON payload + HMAC-SHA256 signing
3. For email integrations: build HTML template + send via SMTP
4. If all project tasks are `done`: also fire `project.complete` event
5. Creates `WebhookDelivery` log row per attempt

**`rules_engine.py`** — evaluates `WorkflowRule` rows on task create/update. Supports conditions on status, priority, labels, assignee. Actions: set status/priority/assignee, add/remove label, add comment, fire event. Max recursion depth of 2 to prevent infinite loops.

**`scheduler.py`** — asyncio background loop, ticks every 3600 seconds. Four jobs:
1. Due-date reminders (`task.due_soon` / `task.overdue`)
2. Recurring task generation from `RecurrenceRule` templates
3. Failed webhook delivery retries (backoff: 1, 5, 30, 120, 360 min)
4. Daily summary email at `SUMMARY_HOUR` UTC

**`ws_manager.py`** — singleton `ConnectionManager` for WebSocket broadcast. Routers call `await ws_manager.broadcast(event, data)` after mutations. Frontend auto-reconnects and invalidates React Query caches.

**`llm.py`** — provider-agnostic LLM interface. `get_provider()` reads `LLM_PROVIDER` env var and returns `ClaudeProvider`, `OpenAIProvider`, or `StubProvider`.

**`assistant_tools.py`** — tool definitions for the LLM assistant: `get_summary`, `list_tasks`, `create_task`, `update_task`, `create_subtask`, `manage_labels`, `analyze_workload`, `search`, `get_activity`.

**`activity.py`** — writes entries to `ActivityLog` table via `log_activity()`. Does `db.flush()` not `db.commit()`.

**`email_sender.py`** — SMTP delivery with HTML + plain-text templates

**`rate_limiter.py`** — rate limiting for public share endpoints

**`pin_utils.py`** — PIN hashing/verification for share link protection

## Frontend (`frontend/src/`)

| Path | Role |
|---|---|
| `main.jsx` | React entry, `QueryClientProvider`, `ToastProvider` |
| `App.jsx` | `BrowserRouter`, `AuthProvider`, top-level routes, `Layout` + `Sidebar`, global CSS |
| `api/client.js` | Axios instance with Bearer token interceptor + 401 redirect |
| `context/AuthContext.jsx` | Auth state: `isAuthenticated`, `login()`, `logout()` |
| `context/ToastContext.jsx` | Toast notification state |
| `constants/theme.js` | `BRAND` color, `STATUS_MAP`, `PRIORITY` tokens |
| `hooks/useRealtimeSync.js` | WebSocket connection to `/ws`, auto-reconnect, React Query invalidation |
| `pages/` | Page components (one per route) |
| `components/` | Shared UI components |

### Routing

```
App
├── Route "/"              → Overview (public status page)
├── Route "/s/:token"      → ShareView (public identity share page)
├── Route "/login"         → Login
└── Route "/app/*"         → Layout (auth-gated)
      ├── index            → Dashboard
      ├── projects/:id     → ProjectDetail
      ├── identities       → Identities
      ├── integrations     → Integrations
      ├── api-keys         → ApiKeys
      ├── analytics        → Analytics
      └── workflow-rules   → WorkflowRules
```

`Layout` reads `useAuth()` and redirects to `/login?next=...` if `authRequired && !isAuthenticated`.

### API Client

All requests go through `api/client.js`:
- Request interceptor: attaches `Authorization: Bearer {token}` from `localStorage`
- Response interceptor: on 401, clears token and redirects to `/login` (unless already on `/` or `/login`)
- `getShareData()` uses a plain `axios` instance (no auth interceptor) for public share endpoints

### Real-time Sync

`hooks/useRealtimeSync.js` connects to the `/ws` WebSocket endpoint:
- Auto-reconnects on disconnect (3-second delay)
- Invalidates `['projects']` and `['project', id]` React Query caches on `task.*` and `project.*` events
- Enables live updates across tabs without polling

### Key Components

**`IssueRow.jsx`** — orchestrator component for task rows. Renders inline edit, comments panel, dependencies panel, recurrence panel, and attachments panel. Subtasks render recursively with `depth + 1`.

**`ProjectDetail.jsx`** — loads full project with tasks, labels, and cycles. Supports board (kanban), table, and Gantt chart views. Client-side search filter on task title.

**`CommandPalette`** — ⌘K / Ctrl+K fuzzy search over projects and tasks.

**`AssistantPanel`** — floating bottom-right button; SSE streaming chat panel with prompt templates (Summary, Overdue, Workload, Recent, Plan today).

### Styling

Dark theme with all inline styles (no CSS modules or Tailwind):
- Background: `#07080f`, Sidebar: `#03040a`
- Brand color: `#818cf8` (indigo)
- Animations defined in `GLOBAL_CSS` string in `App.jsx`

## Data Models

### Core

```
Identity ──< ProjectIdentity >── Project ──< Task
                                         ──< Label ──< TaskLabel >── Task
                                         ──< Cycle ──< CycleTask >── Task
                                         ──< ActivityLog
                                         ──< Attachment
```

### Task

```python
Task:
  id              UUID  PK
  project_id      FK → Project
  parent_id       FK → Task (nullable, for subtasks)
  title           str
  description     text (nullable, markdown)
  status          "todo" | "in_progress" | "done" | "failed"
  priority        "low" | "medium" | "high"
  callback_token  UUID  UNIQUE  # inbound webhook identifier
  assignee        str (nullable)
  start_date      datetime (nullable)
  due_date        datetime (nullable)
  created_at      datetime
  updated_at      datetime
```

### Integration

```python
Integration:
  id                    UUID  PK
  name                  str
  type                  "jenkins" | "drone" | "generic" | "email"
  url                   str  (empty for email)
  secret                str (nullable)  # Bearer token for outbound auth
  project_id            FK → Project (nullable = global)
  events                JSON[]  # ["task.done", "task.failed", "project.complete", ...]
  active                bool
  email_to              str (nullable)  # comma-separated
  email_subject_prefix  str (nullable)
```

### ApiKey

```python
ApiKey:
  id          UUID  PK
  name        str
  key         str  UNIQUE  # "tdp_..." prefix
  project_id  FK → Project (nullable = all projects)
  scopes      JSON[]  # ["read", "write", "admin"]
  active      bool
  last_used_at datetime (nullable)
```

### Comment

```python
Comment:
  id          UUID  PK
  task_id     FK → Task
  project_id  FK → Project (nullable)
  author      str (nullable)
  body        text (markdown)
  created_at  datetime
  updated_at  datetime
```

### RecurrenceRule

```python
RecurrenceRule:
  id                UUID  PK
  template_task_id  FK → Task
  frequency         "daily" | "weekly" | "monthly" | "interval"
  interval_value    int  (every N days, used when frequency=interval)
  day_of_week       int (nullable, 0=Mon…6=Sun, weekly only)
  day_of_month      int (nullable, 1-31, monthly only)
  next_run_at       datetime
  last_run_at       datetime (nullable)
  end_date          datetime (nullable)
  active            bool
  created_at        datetime
```

### WorkflowRule

```python
WorkflowRule:
  id          UUID  PK
  name        str
  project_id  FK → Project (nullable = global)
  trigger     "task.created" | "task.status_changed" | "task.label_added" | "task.priority_changed"
  conditions  JSON[]  # [{field, op, value}, ...]
  actions     JSON[]  # [{type, value}, ...]
  active      bool
  run_count   int
  last_run_at datetime (nullable)
  created_at  datetime
```

### TaskTemplate

```python
TaskTemplate:
  id          UUID  PK
  name        str
  description str (nullable)
  priority    "low" | "medium" | "high"
  subtasks    JSON[]  # predefined subtask list
  label_names JSON[]  # label names to auto-assign
  project_id  FK → Project (nullable = global)
  created_at  datetime
```

### Attachment

```python
Attachment:
  id            UUID  PK
  task_id       FK → Task
  project_id    FK → Project
  filename      str
  content_type  str
  size          int  (bytes)
  storage_path  str  (server filesystem path)
  created_at    datetime
```

### WebhookDelivery

```python
WebhookDelivery:
  id              UUID  PK
  integration_id  FK → Integration
  event           str
  payload         JSON
  request_url     str
  request_headers JSON
  attempt         int
  status          "pending" | "success" | "failed" | "dead"
  status_code     int (nullable)
  response_body   str (nullable)
  error           str (nullable)
  next_retry_at   datetime (nullable)
  delivered_at    datetime (nullable)
  created_at      datetime
```

### AssistantConversation / AssistantMessage

```python
AssistantConversation:
  id          UUID  PK
  title       str  (auto-set from first user message)
  created_at  datetime
  updated_at  datetime

AssistantMessage:
  id              UUID  PK
  conversation_id FK → AssistantConversation
  role            "user" | "assistant" | "tool"
  content         text
  tool_calls      JSON (nullable)
  created_at      datetime
```

## CI/CD Webhook Data Flow

```
1. Task created in UI
   callback_token (UUID) is auto-generated

2. Paste webhook URL into CI/CD pipeline:
   POST http://your-domain/webhook/callback/{callback_token}

3. CI/CD fires POST on completion:
   Body: { "status": "done", "message": "Build #42 passed" }

4. Backend:
   a. Looks up task by callback_token
   b. Updates task.status + task.updated_at
   c. Logs ActivityLog entry (actor="webhook")
   d. Calls notifier.fire_notifications(event="task.done", ...)
      → HTTP POST to matching webhook integrations (HMAC-signed)
      → Email to matching email integrations
      → WebhookDelivery row logged per attempt
   e. If all project tasks done:
      Calls notifier.fire_notifications(event="project.complete", ...)
   f. Calls run_rules() for status_changed trigger
   g. Broadcasts WebSocket event for real-time UI sync

5. Outbound notification payload:
   {
     "event": "task.done",
     "project": { "id", "name", "progress", "total_tasks", "done_tasks" },
     "task": { "id", "title", "status", "priority" },
     "timestamp": "ISO 8601"
   }
```

## Workflow Rules Engine

```
Task created or updated
  → run_rules(db, trigger, task, context)
  → For each active WorkflowRule matching the trigger:
      1. Evaluate all conditions (field/op/value against task attributes)
      2. If all match → execute actions:
         - set_status, set_priority, set_assignee
         - add_label, remove_label
         - add_comment
         - fire_event (triggers notifications)
      3. Recursion guard: _rule_depth tracked in context, max depth 2
```

## LLM Assistant Flow

```
POST /assistant/conversations/{id}/messages
  → SSE stream: text chunks, tool_start, tool_result, done
  → dispatch_tool() executes DB operations directly
  → Saves AssistantMessage after done event

Provider selection via LLM_PROVIDER env var:
  "claude" → ClaudeProvider (Anthropic SDK)
  "openai" → OpenAIProvider (OpenAI SDK)
  "stub"   → StubProvider (default, no external calls)
```

## Share Page Flow

```
GET /share/identity/{share_token}
  → Rate-limited
  → Check expiry (410 if expired)
  → If PIN set and no valid session cookie → return { requires_pin: true }
  → POST /share/identity/{token}/verify { pin } → sets session cookie (15 min TTL)
  → Returns: identity info, projects with tasks, recent activity, summary stats
  → Logs view (max 1 per IP-hash per hour)
```

## Auth Flow

```
Startup:
  AuthProvider mounts → GET /auth/me (with stored token if any)
    → { auth_required: false } → always authenticated (no password set)
    → { auth_required: true, ok: true } → authenticated
    → { auth_required: true, ok: false } / 401 → not authenticated

Login:
  POST /auth/login { password }
  → server checks password == AUTH_PASSWORD env var
  → returns { token: sha256(password) }
  → stored in localStorage as "auth_token"
  → all subsequent API requests include Authorization: Bearer {token}

Backend middleware:
  token == sha256(AUTH_PASSWORD) → 200
  else → 401

Logout:
  Clear localStorage → redirect to /login
```
