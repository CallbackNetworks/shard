# Architecture

## Overview

```
Browser
  └── Frontend (React/Vite :5173)
        ├── /*        →  Management UI (auth-gated)
        └── /share/*  →  Public share pages
              │
              │ Vite proxy (dev) / nginx reverse-proxy (prod)
              ▼
         Backend (FastAPI :8000)
              ├── SQLite | PostgreSQL | MySQL (persisted volume / server)
              ├── WebSocket (/ws) for real-time sync
              └── Outbound: webhooks, SMTP, LLM providers, issue trackers
              ▲
              │ /api/v1 over HTTP (X-API-Key)
         MCP server (stdio | Streamable HTTP :8001)
```

Both services run in Docker Compose with host-mounted source directories for hot-reload.
The MCP server is a separate process behind the `mcp` profile and holds no database
connection of its own — it proxies everything through `/api/v1` (ADR-0005).

## The core idea: one graph

Every first-class entity — project, task, label, cycle, goal, identity, and any type a user
invents at runtime — is a row in **`nodes`**. Every relationship between them is a row in
**`edges`**. There are no per-entity tables and no container foreign keys (ADR-0032/0033).

What an entity *can do* is not encoded in its class but in its type's **roles** set
(ADR-0040): `container`, `task`, `shareable`, `subscribable`. A project is
`{container, shareable, subscribable}`; a goal is `{container}`; a user-defined "Area" type
becomes a real container the moment someone adds `container` to its roles — no schema change,
no code change, no deploy.

Two consequences shape the whole backend:

1. **One write surface.** All entity create/update/delete goes through `POST`/`PATCH`/
   `DELETE /api/nodes` internally and `/api/v1/nodes` externally (ADR-0040 → ADR-0043).
   Per-entity write routes were retired and now return 405.
2. **Dispatch by role, not by URL.** `services/graph_dispatch.py` decides what a write
   *means* from the target's roles. Creating a `container`-role node seeds its share token;
   deleting one cascades its owned tasks. Because the reaction hangs off the state
   transition rather than the endpoint, a node cannot be created through a "generic" path
   and silently skip the behaviour its type implies.

## Backend (`backend/app/`)

| File / Directory | Role |
|---|---|
| `main.py` | FastAPI app, middleware, router mounts under `/api`, DB init + Alembic stamp, scheduler startup |
| `models.py` | SQLAlchemy ORM models (graph tables + peripheral tables) |
| `schemas.py` | Pydantic v2 request/response schemas |
| `database.py` | Engine, session factory, `Base`, `get_db` |
| `routers/` | Route handlers (one file per resource) |
| `routers/external_api/` | The `/api/v1` external surface (`sub_router` per module) |
| `services/graph/` | The graph facade — the only module that touches `nodes`/`edges` |
| `services/` | Business logic called by routers |
| `migrations/` | Alembic migration scripts (`render_as_batch=True` for SQLite) |

### Middleware

`AuthMiddleware` (Starlette `BaseHTTPMiddleware`) runs on every request:
- If neither `AUTH_PASSWORD` nor `AUTH_PROXY_HEADER` is set → passes all requests through
- Bypass prefixes: `/api/auth/`, `/health`, `/webhook/`, `/share/`, `/ical/`, `/ws`, `/docs`, `/openapi.json`, `/redoc`, `/api/v1/`
- Everything else requires `Authorization: Bearer {token}`; tokens expire after `AUTH_TOKEN_TTL` and logins are IP-throttled
- With `AUTH_PROXY_HEADER` set, an upstream SSO proxy's identity header is trusted instead (ADR-0030) — only safe when the origin is reachable exclusively through that proxy
- Returns `401` JSON on failure

`/api/v1/` is bypassed deliberately: the API key *is* the auth mechanism there.

### Routers

Internal routers are mounted under a single `APIRouter(prefix="/api")` (ADR-0036), so the
paths below are all relative to `/api`. Adding an SPA-facing router needs no proxy or nginx
change; only a new *root-level* route does.

| Router | Mount | Description |
|---|---|---|
| `auth` | `/auth` | Login, logout, token verify |
| `nodes` | `/nodes` | **The write surface** — node create/update/delete, edges, share facade, events |
| `nodes.graph_router` | `/graph` | One-shot `{nodes, edges}` map slice for the structure view |
| `graph_types` | `/graph-types` | Node-type / edge-type vocabulary (roles are edited here) |
| `projects` | `/projects` | Project reads, share-views, expiry |
| `tasks` | `/projects/{pid}/tasks` | Task reads + sub-resources (reorder, export, external issue) |
| `labels` | `/projects/{pid}/labels` | Label reads; task↔label links |
| `cycles` | `/projects/{pid}/cycles` | Cycle reads, task assignment, duplicate, compare |
| `comments` | `/projects/{pid}/tasks/{tid}/comments` | Task comments CRUD |
| `recurring` | `/projects/{pid}/tasks/{tid}/recurrence` | Recurrence rule management |
| `attachments` | `/projects/{pid}/tasks/{tid}/attachments` | File upload/download/delete |
| `identities` | `/identities` | Identity reads, hub stats, project lists, share views |
| `goals` | `/goals` | Goal reads + subtree progress |
| `decisions` | `/decisions` | Decision records (enhanced labels) + export |
| `bulk` | `/projects/{pid}/tasks/bulk-update` | Multi-task update in one request |
| `imports` | `/projects/{pid}/import/*` | GitHub / Linear / Trello import |
| `integrations` | `/integrations` | Outbound notification targets + templates + health |
| `webhook_logs` | `/integrations/{id}/deliveries`, `/deliveries` | Delivery logs, manual retry, purge |
| `notifications` | `/notifications` | In-app notification feed |
| `cicd` | `/cicd/trigger/*` | Outbound build triggers |
| `api_keys` | `/api-keys` | API key management + agent usage summary |
| `activity` | `/activity` | Activity log (read-only) |
| `search` | `/search` | Cross-resource search |
| `analytics` | `/analytics` | Overview, heatmap, burndown, velocity, trend, critical path, usage |
| `templates` | `/templates` | Task template CRUD |
| `saved_filters` | `/saved-filters` | Saved filter views |
| `workflow_rules` | `/workflow-rules` | Automation rules CRUD + dry-run testing |
| `assistant` | `/assistant` | LLM chat with SSE streaming + tool use |
| `settings` | `/settings` | Runtime settings, preferences, iCal token, password |
| `backup` | `/backup` | Backup status/run/export/download/restore |

Root-level mounts (external contracts, never under `/api`):

| Router | Mount | Description |
|---|---|---|
| `external_api` | `/api/v1` | External REST API (X-API-Key auth) |
| `webhooks` | `/webhook` | Inbound CI/CD callbacks |
| `issue_sync` | `/webhook/issues` | Inbound issue/PR sync from GitHub/GitLab |
| `share` | `/share` | Public read-only share pages (PIN/expiry optional) |
| `bulk.ical_router` | `/ical` | Calendar subscription feeds |
| `ws` | `/ws` | WebSocket endpoint for real-time events |

### Services

**`graph/`** — the facade over `nodes`/`edges`, split by entity view (`core`, `projects`,
`tasks`, `labels`, `cycles`, `goals`, `identities`). Routers never write raw graph rows; they
call `graph.*`. It returns lightweight view objects (`ProjectView`, `TaskView`, `CycleView`, …)
so the rest of the codebase reads as if the old tables still existed.

**`graph_dispatch.py`** — role-driven reaction layer for `/api/nodes`. `dispatch_node_created`
/ `_updated` / `_deleted` look up the target type's roles and run the matching domain
behaviour: task-role nodes go through the task pipeline, container-role nodes seed share
tokens on create and cascade on delete (`graph.delete_container`), everything else gets a
plain node write.

**`task_mutations.py`** — the single post-mutation sequence for tasks (ADR-0038).
`finalize_task_create` and `apply_task_update` run, in order: activity log → workflow rules →
outbound notifications → external issue sync → WebSocket broadcast. **Any new code path that
creates or updates a task must go through these two functions**; hand-rolling the sequence is
how rules and notifications get silently skipped.

**`notifier.py`** — fires outbound notifications after task status changes or project completion:
1. Query integrations whose `events` array contains the event type
2. Webhook integrations: async `httpx.post` with JSON payload + HMAC-SHA256 signature
3. Email integrations: HTML template via SMTP
4. If all project tasks are `done`: also fire `project.complete`
5. Creates a `WebhookDelivery` log row per attempt

**`rules_engine.py`** — evaluates `WorkflowRule` rows on task create/update. Conditions on
status, priority, labels, assignee. Actions: set status/priority/assignee, add/remove label,
add comment, fire event. Max recursion depth 2.

**`scheduler.py`** — asyncio background loop, ticks every 3600 seconds. Seven jobs:
1. Due-date reminders (`task.due_soon` / `task.overdue`)
2. Recurring task generation from `RecurrenceRule` templates
3. Failed webhook delivery retries (backoff: 1, 5, 30, 120, 360 min)
4. Daily summary email at `SUMMARY_HOUR` UTC
5. Weekly digest email on `DIGEST_DAY`
6. SLA aging checks on stalled tasks
7. Daily backup at `BACKUP_HOUR` with `BACKUP_KEEP` retention

**`issue_sync.py`** — two-way sync with GitHub/GitLab issues: create an external issue from a
task, mirror status and milestone outward, and apply inbound issue/PR events.

**`ws_manager.py`** — singleton `ConnectionManager` for WebSocket broadcast. Callers do
`await ws_manager.broadcast(event, data)` after mutations; the frontend auto-reconnects and
invalidates React Query caches.

**`llm.py`** — provider-agnostic LLM interface. `get_provider()` reads `LLM_PROVIDER` and
returns `ClaudeProvider`, `OpenAIProvider`, or `StubProvider`.

**`assistant_tools.py`** — tools exposed to the LLM assistant: `get_summary`, `list_tasks`,
`create_task`, `update_task`, `create_subtask`, `manage_labels`, `analyze_workload`, `search`,
`get_activity`, `analyze_decisions`, `create_decision`, `tag_task_with_decision`,
`batch_create_tasks`.

**`activity.py`** — writes `ActivityLog` rows via `log_activity()`. Does `db.flush()`, not
`db.commit()`, so it joins the caller's transaction.

**`cicd_adapters.py`** — detects the CI/CD provider from request headers (GitHub, GitLab,
Jenkins, Drone, Bitbucket) and normalizes inbound payloads to one shape.

**`enrichment.py`** — assembles `TaskOut` / `ProjectOut` aggregates (labels, counts,
dependencies, recurrence, progress, cycle stats).

**`critical_path.py`** — longest-path analysis over `depends_on` edges.

**`search_backend.py`** — cross-entity search; **`backup.py`** — archive write/restore/prune;
**`runtime_settings.py`** — DB-persisted settings that need no restart (ADR-0011);
**`usage_tracker.py`** — per-API-key usage counters; **`email_sender.py`** — SMTP with HTML +
plain-text templates; **`rate_limiter.py`** — throttling for public share endpoints;
**`pin_utils.py`** — PIN hashing/verification; **`ical_token.py`** — signed feed tokens;
**`integration_templates.py`** — preset integration configurations;
**`graph_registry.py`** — node/edge type registry lookups.

## Frontend (`frontend/src/`)

| Path | Role |
|---|---|
| `main.jsx` | React entry, `QueryClientProvider`, `ToastProvider` |
| `App.jsx` | `BrowserRouter`, `AuthProvider`, top-level routes, `Layout` + `Sidebar` |
| `api/client.js` | Axios instance (`baseURL: /api`) with Bearer token interceptor + 401 redirect |
| `context/AuthContext.jsx` | Auth state: `isAuthenticated`, `login()`, `logout()` |
| `context/ToastContext.jsx` | Toast notification state |
| `context/IdentityFocusContext.jsx` | Which identity the UI is currently scoped to |
| `constants/theme.js` | `BRAND` color, `STATUS_MAP`, `PRIORITY` tokens |
| `constants/nodeRoles.js` | Role vocabulary mirroring the backend roles set |
| `hooks/useRealtimeSync.js` | WebSocket connection to `/ws`, auto-reconnect, query invalidation |
| `hooks/useOfflineSync.js` | IndexedDB queue for mutations made while offline |
| `styles/global.css` | Design tokens, keyframes, shared utilities |
| `pages/` | Page components (one per route) |
| `components/` | Shared UI components + co-located CSS Modules |

### Routing

```
App
├── /share/:token       → ShareView (identity scope)
├── /share/p/:token     → ShareView (project scope)
├── /share/n/:token     → ShareView (generic node scope)
├── /login              → Login
└── /*                  → Layout (auth-gated)
      ├── index             → Dashboard
      ├── projects/:id      → ProjectDetail
      ├── identities        → Identities
      ├── goals             → Goals
      ├── decisions         → Decisions
      ├── integrations      → Integrations
      ├── webhook-logs      → WebhookLogs
      ├── api-keys          → ApiKeys
      ├── analytics         → Analytics
      ├── workflow-rules    → WorkflowRules
      ├── templates         → Templates
      ├── activity          → Activity
      ├── assistant         → Assistant
      ├── settings          → Settings
      ├── structure         → StructureMap
      ├── graph-types       → GraphTypes
      ├── explorer          → NodeExplorer
      ├── unfiled           → Unfiled
      ├── n/:id             → NodePage        (any node)
      ├── c/:id             → ContainerView   (any container-role node)
      └── t/:typeKey        → TypeNodesPage   (all nodes of one type)
```

The `n/` `c/` `t/` routes are the graph-native counterpart of the fixed pages: user-defined
types get a real UI without anyone adding a route for them (ADR-0037).

`Layout` reads `useAuth()` and redirects to `/login?next=...` if `authRequired && !isAuthenticated`.

### API Client

All internal requests go through `api/client.js`:
- `baseURL` is `/api` (ADR-0036), so backend paths never collide with SPA page routes
- Request interceptor attaches `Authorization: Bearer {token}` from `localStorage`
- Response interceptor: on 401, clears the token and redirects to `/login` (unless already on `/` or `/login`)
- Share functions use a plain `axios` instance — no auth interceptor, no `/api` prefix — because share endpoints stay at root

Entity writes in the client compose the node call plus any edge calls, so callers keep their
old function signatures even though the underlying surface is `/api/nodes`.

### Real-time Sync

`hooks/useRealtimeSync.js` connects to `/ws`:
- Auto-reconnects on disconnect (3-second delay)
- Invalidates `['projects']` and `['project', id]` caches on `task.*`, `project.*`, and `node.*` events
- Enables live updates across tabs without polling

### Key Components

**`IssueRow.jsx`** — orchestrator for task rows: inline edit, comments, dependencies,
recurrence, and attachments panels. Subtasks render recursively with `depth + 1`.

**`ProjectDetail.jsx`** — loads a full project (tasks, labels, cycles). Board, table, Gantt,
and calendar views; bulk actions, saved filter views, JSON import/export, board WIP limits.

**`StructureMap.jsx`** — renders the whole graph from `GET /api/graph/map`, deriving every
node's shape from its type's roles rather than from hardcoded entity branches.

**`CommandPalette`** — ⌘K / Ctrl+K fuzzy search over projects and tasks.

**`AssistantPanel`** — SSE streaming chat panel with prompt templates.

### Styling

Dark theme, no Tailwind and no CSS-in-JS (ADR-0012). Three layers:
- `styles/global.css` — design tokens, keyframes, shared utilities
- Co-located CSS Modules (`Component.module.css`, imported as `s`) for component-scoped styles
- Inline `style={{...}}` only for genuinely dynamic values

Background `#07080f`, sidebar `#03040a`, brand `#818cf8` (indigo). When significantly editing
a component, migrate its static inline styles to a CSS Module.

## Data Models

### The graph

```
Node ──< Edge >── Node          (edges.source_id → nodes.id, edges.target_id → nodes.id)

NodeType  — vocabulary + roles for nodes.type
EdgeType  — vocabulary + traversal flags for edges.rel_type
GraphEvent — append-only audit trail of node/edge mutations
```

```python
Node:
  id          UUID  PK
  type        str   FK → NodeType.key    # project/task/label/cycle/goal/identity/<custom>
  title       str
  status      str (nullable, indexed)
  priority    str (nullable)
  start_date  datetime (nullable)
  due_date    datetime (nullable, indexed)
  position    int
  is_pinned   bool
  data        JSON (nullable)            # type-specific long-tail fields
  created_at  datetime
  updated_at  datetime
```

Hot query fields are real indexed columns; everything else (description, assignee,
`callback_token`, `share_token`, `repo_url`, `agent_instructions`, time tracking, …) lives in
`data`. Node ids are the original entity UUIDs, so peripheral tables that reference them
(comments, attachments, activity logs) stayed valid across the migration.

```python
Edge:
  id         UUID  PK
  source_id  FK → Node  (CASCADE)
  target_id  FK → Node  (CASCADE)
  rel_type   str        # contains | member_of | assigned_to | depends_on | labeled | in_cycle
  position   int
  data       JSON (nullable)
  created_at datetime
  UNIQUE (source_id, target_id, rel_type)
```

Canonical direction is source → target. `contains` replaced both `project_id` and `parent_id`:
a subtask is a task contained by a task, and a project's tasks are the task-role nodes it
contains. There is no structural difference between the two.

```python
NodeType:
  key         str  PK              # value written into nodes.type
  label       str
  icon, color str (nullable)
  is_builtin  bool
  roles       JSON[]               # subset of {container, task, shareable, subscribable}
  data        JSON (nullable)

EdgeType:
  key            str  PK           # value written into edges.rel_type
  label          str
  is_builtin     bool
  is_containment bool              # participates in contains-style traversal
  is_symmetric   bool              # undirected relation

GraphEvent:
  id         UUID  PK
  event      str                   # node_created | node_deleted | edge_added | edge_removed
  node_id, source_id, target_id  str (nullable, indexed)
  rel_type   str (nullable)
  actor      str (nullable)
  data       JSON (nullable)
  created_at datetime (indexed)
```

`GraphEvent` is the deliberate audit-trail form of provenance rather than bitemporal edges:
live edges stay hard-deletable, while past state can be reconstructed by replay.

### Peripheral tables

These hang off nodes by id but are not themselves nodes — they have no independent identity
in the graph and no need for typed relationships.

```python
Comment:            id, task_id, project_id, author, body, created_at, updated_at
Attachment:         id, task_id, project_id, filename, content_type, size, storage_path, created_at
ActivityLog:        id, project_id, task_id, action, actor, detail, meta, created_at
Notification:       id, task_id, project_id, event, title, body, read_at, created_at
SavedFilter:        id, project_id, name, filters JSON, created_at
UserPreference:     key PK, value JSON, updated_at
TaskPullRequest:    id, task_id, provider, number, url, state, merged_at
WebhookEvent:       id, task_id, provider, event, payload JSON, created_at
```

```python
Integration:
  id, name
  type                  "jenkins" | "drone" | "generic" | "email"
  url                   str  (empty for email)
  secret                str (nullable)   # HMAC signing key / bearer token
  project_id            FK → Node (nullable = global)
  events                JSON[]           # ["task.done", "project.complete", ...]
  active                bool
  email_to              str (nullable)   # comma-separated
  email_subject_prefix  str (nullable)

ApiKey:
  id, name
  key           str  UNIQUE              # "tdp_..." prefix
  project_id    FK → Node (nullable = all projects)
  scopes        JSON[]                   # ["read", "write", "admin"]
  active        bool
  last_used_at  datetime (nullable)

WorkflowRule:
  id, name
  project_id  FK → Node (nullable = global)
  trigger     "task.created" | "task.status_changed" | "task.label_added" | "task.priority_changed"
  conditions  JSON[]                     # [{field, op, value}, ...]
  actions     JSON[]                     # [{type, value}, ...]
  active, run_count, last_run_at, created_at

RecurrenceRule:
  id
  template_task_id  FK → Node
  frequency         "daily" | "weekly" | "monthly" | "interval"
  interval_value    int
  day_of_week       int (nullable, 0=Mon…6=Sun)
  day_of_month      int (nullable, 1-31)
  next_run_at, last_run_at, end_date, active, created_at

TaskTemplate:
  id, name, description, priority
  subtasks     JSON[]                    # predefined subtask list
  label_names  JSON[]                    # labels to auto-assign
  project_id   FK → Node (nullable = global)
  created_at

WebhookDelivery:
  id
  integration_id  FK → Integration
  event, payload JSON, request_url, request_headers JSON
  attempt         int
  status          "pending" | "success" | "failed" | "dead"
  status_code, response_body, error, next_retry_at, delivered_at, created_at

AssistantConversation:  id, title, created_at, updated_at
AssistantMessage:       id, conversation_id FK, role, content, tool_calls JSON, created_at
```

### Databases

SQLite, PostgreSQL, and MySQL are all supported via `DATABASE_URL`. SQLite and PostgreSQL are
**co-equal test targets** — the same suite runs against both in CI with the same coverage gate,
and neither is primary (ADR-0018/0020). Alembic runs in batch mode so migrations work on
SQLite; on a fresh database the lifespan creates all tables and stamps the Alembic chain to head.

## Write Path

```
POST /api/nodes { type, title, container_id?, parent_id?, ... }
  → routers/nodes.py validates against NodeType
  → graph.create_node()  (+ role-driven seeding, e.g. share_token for shareable types)
  → dispatch_node_created()
      ├── type has "task" role      → finalize_task_create()
      │                                 → log_activity
      │                                 → run_rules("task.created")
      │                                 → fire_notifications
      │                                 → issue_sync (if linked)
      │                                 → ws_manager.broadcast("task.created")
      ├── type has "container" role → seed share facade, broadcast "project.created"
      └── otherwise                 → broadcast "node.created"
```

`PATCH` follows the same shape through `dispatch_node_updated` → `apply_task_update`.
`DELETE` routes container-role nodes to `graph.delete_container()`, which removes the
container, its exclusively-owned tasks, and its scoped labels and cycles, while unlinking
tasks that also live in another container (ADR-0043).

## CI/CD Webhook Data Flow

```
1. Task created in UI
   callback_token (UUID) is auto-generated into node.data

2. Paste webhook URL into the CI/CD pipeline:
   POST http://your-domain/webhook/callback/{callback_token}

3. CI/CD fires POST on completion:
   Body: { "status": "done", "message": "Build #42 passed" }

4. Backend:
   a. Looks up the task node by callback_token
   b. apply_task_update(status=..., source="webhook")
      → ActivityLog entry (actor="webhook")
      → run_rules() for the status_changed trigger
      → fire_notifications(event="task.done")
          → HTTP POST to matching webhook integrations (HMAC-signed)
          → Email to matching email integrations
          → WebhookDelivery row per attempt
      → WebSocket broadcast for real-time UI sync
   c. If all tasks in the container are done:
      fire_notifications(event="project.complete")

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
Task created or updated (always via task_mutations)
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

`run_rules` has exactly two call sites, both inside `task_mutations.py`. That is intentional:
it is what guarantees a task cannot change without rules getting their chance.

## LLM Assistant Flow

```
POST /api/assistant/conversations/{id}/messages
  → SSE stream: text chunks, tool_start, tool_result, done
  → dispatch_tool() executes DB operations directly
  → Saves AssistantMessage after the done event

Provider selection via LLM_PROVIDER env var:
  "claude" → ClaudeProvider (Anthropic SDK)
  "openai" → OpenAIProvider (OpenAI SDK)
  "stub"   → StubProvider (default, no external calls)
```

## Share Page Flow

```
GET /share/identity/{token} | /share/project/{token} | /share/n/{token}
  → Rate-limited
  → Check expiry (410 if expired)
  → If PIN set and no valid session cookie → return { requires_pin: true }
  → POST /share/{scope}/{token}/verify { pin } → sets session cookie (15 min TTL)
  → Returns: node info, contained projects/tasks, recent activity, summary stats
  → Logs the view (max 1 per IP-hash per hour)
```

Any node whose type carries the `shareable` role can be shared through `/share/n/{token}`;
the identity and project routes are the named cases of the same mechanism (ADR-0039/0041).

## Auth Flow

```
Startup:
  AuthProvider mounts → GET /api/auth/me (with stored token if any)
    → { auth_required: false } → always authenticated (no password set)
    → { auth_required: true, ok: true } → authenticated
    → { auth_required: true, ok: false } / 401 → not authenticated

Login:
  POST /api/auth/login { password }
  → server checks the password against AUTH_PASSWORD, throttled per IP
    (AUTH_MAX_ATTEMPTS failures → AUTH_LOCKOUT_SECONDS lockout)
  → returns { token }, valid for AUTH_TOKEN_TTL seconds
  → stored in localStorage as "auth_token"
  → all subsequent internal API requests send Authorization: Bearer {token}

Forward-auth alternative (ADR-0030):
  AUTH_PROXY_HEADER set → the upstream SSO proxy's identity header is trusted,
  no password step. Only safe when the origin is reachable exclusively via that proxy.

Logout:
  POST /api/auth/logout → server invalidates the token
  → clear localStorage → redirect to /login
```
