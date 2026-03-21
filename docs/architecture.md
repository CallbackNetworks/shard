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
              └── Outbound: webhooks, SMTP
```

Both services run in Docker Compose with host-mounted source directories for hot-reload.

## Backend (`backend/app/`)

| File / Directory | Role |
|---|---|
| `main.py` | FastAPI app, middleware registration, router mounts, DB init |
| `models.py` | SQLAlchemy ORM models |
| `schemas.py` | Pydantic request/response schemas |
| `database.py` | Engine, session factory, `Base` |
| `routers/` | Route handlers (one file per resource) |
| `services/` | Business logic called by routers |

### Middleware

`AuthMiddleware` (Starlette `BaseHTTPMiddleware`) runs on every request:
- If `AUTH_PASSWORD` env var is unset → passes all requests through
- Bypass paths (no auth needed): `/auth/`, `/health`, `/webhook/`, `/docs`, `/openapi.json`, `/redoc`
- All other paths require `Authorization: Bearer {sha256(AUTH_PASSWORD)}`
- Returns `401` JSON on failure

### Routers

| Router | Mount | Description |
|---|---|---|
| `auth` | `/auth` | Login + token verify |
| `projects` | `/projects` | Project CRUD |
| `tasks` | `/projects/{pid}/tasks` | Task CRUD |
| `labels` | `/projects/{pid}/labels` | Label CRUD, task-label links |
| `cycles` | `/projects/{pid}/cycles` | Cycle/sprint CRUD + task assignments |
| `webhooks` | `/webhook` | Inbound CI/CD callbacks |
| `integrations` | `/integrations` | Outbound notification targets |
| `identities` | `/identities` | Identity CRUD + project links |
| `api_keys` | `/api-keys` | API key management |
| `activity` | `/activity` | Activity log (read-only) |
| `external_api` | `/api/v1` | External REST API (API key auth) |

### Services

**`notifier.py`** — fires outbound notifications after task status changes or project completion:
1. Query integrations whose `events` array contains the event type
2. For webhook integrations: async `httpx.post` with JSON payload + auth headers
3. For email integrations: build HTML template + send via SMTP
4. If all project tasks are `done`: also fire `project.complete` event

**`activity.py`** — writes entries to `ActivityLog` table

**`email_sender.py`** — SMTP delivery with HTML + plain-text templates

## Frontend (`frontend/src/`)

| Path | Role |
|---|---|
| `main.jsx` | React entry, `QueryClientProvider`, `ToastProvider` |
| `App.jsx` | `BrowserRouter`, `AuthProvider`, top-level routes, `Layout` + `Sidebar` |
| `api/client.js` | Axios instance with Bearer token interceptor + 401 redirect |
| `context/AuthContext.jsx` | Auth state: `isAuthenticated`, `login()`, `logout()` |
| `context/ToastContext.jsx` | Toast notification state |
| `constants/theme.js` | `BRAND` color, `STATUS_MAP`, `PRIORITY` tokens |
| `pages/` | Page components (one per route) |
| `components/` | Shared UI components |

### Routing

```
App
├── Route "/"           → Overview (public status page)
├── Route "/login"      → Login
└── Route "/app/*"      → Layout (auth-gated)
      ├── index         → Dashboard
      ├── projects/:id  → ProjectDetail
      ├── identities    → Identities
      ├── integrations  → Integrations
      └── api-keys      → ApiKeys
```

`Layout` reads `useAuth()` and redirects to `/login?next=...` if `authRequired && !isAuthenticated`.

### API Client

All requests go through `api/client.js`:
- Request interceptor: attaches `Authorization: Bearer {token}` from `localStorage`
- Response interceptor: on 401, clears token and redirects to `/login` (unless already on `/` or `/login`)

## Data Models

### Core

```
Identity ──< ProjectIdentity >── Project ──< Task
                                         ──< Label ──< TaskLabel >── Task
                                         ──< Cycle ──< CycleTask >── Task
                                         ──< ActivityLog
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
      → HTTP POST to matching webhook integrations
      → Email to matching email integrations
   e. If all project tasks done:
      Calls notifier.fire_notifications(event="project.complete", ...)

5. Outbound notification payload:
   {
     "event": "task.done",
     "project": { "id", "name", "progress", "total_tasks", "done_tasks" },
     "task": { "id", "title", "status", "priority" },
     "timestamp": "ISO 8601"
   }
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
