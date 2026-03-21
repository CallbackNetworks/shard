# API Reference

The platform exposes two APIs:

- **Internal API** — used by the web UI, protected by the session Bearer token
- **External API v1** — for scripts and AI agents, authenticated via `X-API-Key` header

Interactive docs (Swagger UI) are always available at `http://localhost:8000/docs`.

---

## Internal API

All endpoints require `Authorization: Bearer {token}` when `AUTH_PASSWORD` is set. Token is obtained via `POST /auth/login`.

### Auth

#### `POST /auth/login`
```json
// Request
{ "password": "your_password" }

// Response 200
{ "token": "sha256hex", "auth_required": true }

// Response 401
{ "detail": "Incorrect password" }
```

#### `GET /auth/me`
Verify current token. No body.

```json
// Response 200 — authenticated
{ "ok": true, "auth_required": true }

// Response 200 — no password set on server
{ "ok": true, "auth_required": false }

// Response 401 — invalid token
{ "detail": "Unauthorized" }
```

---

### Projects

#### `GET /projects`
Returns all projects with computed fields.

```json
[
  {
    "id": "uuid",
    "name": "string",
    "description": "string | null",
    "status": "active | archived",
    "progress": 75.0,
    "total_tasks": 4,
    "done_tasks": 3,
    "identities": [{ "id": "uuid", "name": "string", "color": "#hex", "avatar": "string | null" }],
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

#### `POST /projects`
```json
// Request
{ "name": "string", "description": "string (optional)" }
```

#### `GET /projects/{id}`
Returns project with full task list including subtasks, labels, and cycle assignments.

#### `PATCH /projects/{id}`
```json
{ "name": "string (optional)", "description": "string (optional)", "status": "active | archived (optional)" }
```

#### `DELETE /projects/{id}`
Cascades to all tasks, labels, cycles, and activity logs.

---

### Tasks

#### `GET /projects/{pid}/tasks`
Returns all tasks in the project including subtasks and assigned labels.

#### `POST /projects/{pid}/tasks`
```json
// Request
{
  "title": "string",
  "description": "string (optional, markdown)",
  "status": "todo | in_progress | done | failed (default: todo)",
  "priority": "low | medium | high (default: medium)",
  "assignee": "string (optional)",
  "start_date": "ISO 8601 (optional)",
  "due_date": "ISO 8601 (optional)",
  "parent_id": "uuid (optional, for subtasks)"
}

// Response 200
{
  "id": "uuid",
  "callback_token": "uuid",  // use this for the webhook URL
  ...
}
```

#### `PATCH /projects/{pid}/tasks/{tid}`
Same fields as POST, all optional. Status changes are logged to the activity trail.

#### `DELETE /projects/{pid}/tasks/{tid}`

#### `POST /projects/{pid}/tasks/{tid}/regenerate-token`
Generates a new `callback_token`. The old webhook URL stops working immediately.

```json
{ "callback_token": "new_uuid" }
```

---

### Labels

#### `GET /projects/{pid}/labels`
#### `POST /projects/{pid}/labels`
```json
{ "name": "string", "color": "#hex (optional, default #5e6ad2)" }
```
#### `DELETE /projects/{pid}/labels/{lid}`

#### `POST /projects/{pid}/tasks/{tid}/labels/{lid}`
Assigns a label to a task.

#### `DELETE /projects/{pid}/tasks/{tid}/labels/{lid}`

---

### Cycles

#### `GET /projects/{pid}/cycles`
#### `POST /projects/{pid}/cycles`
```json
{
  "name": "string",
  "description": "string (optional)",
  "start_date": "ISO 8601 (optional)",
  "end_date": "ISO 8601 (optional)",
  "status": "draft | active | completed (default: draft)"
}
```
#### `GET /projects/{pid}/cycles/{cid}`
Returns cycle with its task list.

#### `PATCH /projects/{pid}/cycles/{cid}`
#### `DELETE /projects/{pid}/cycles/{cid}`

#### `POST /projects/{pid}/cycles/{cid}/tasks/{tid}`
Adds a task to a cycle.

#### `DELETE /projects/{pid}/cycles/{cid}/tasks/{tid}`

---

### Integrations

#### `GET /integrations`
#### `POST /integrations`
```json
{
  "name": "string",
  "type": "jenkins | drone | generic | email",
  "url": "string (webhook URL; empty for email type)",
  "secret": "string (optional, sent as Bearer token)",
  "project_id": "uuid (optional, null = global)",
  "events": ["task.done", "task.failed", "task.in_progress", "project.complete"],
  "active": true,
  // Email-specific:
  "email_to": "a@example.com,b@example.com",
  "email_subject_prefix": "[MyProject]"
}
```
#### `PATCH /integrations/{id}`
#### `DELETE /integrations/{id}`

#### `POST /integrations/{id}/test`
Fires a test notification. Returns `{ "ok": true }` or error detail.

---

### Identities

#### `GET /identities`
#### `POST /identities`
```json
{ "name": "string", "color": "#hex", "description": "string (optional)", "avatar": "emoji or char (optional)" }
```
#### `PATCH /identities/{id}`
#### `DELETE /identities/{id}`

#### `POST /identities/{id}/projects/{pid}`
Links a project to an identity.

#### `DELETE /identities/{id}/projects/{pid}`

#### `GET /identities/{id}/projects`
Returns projects linked to the identity (used by the public status page).

---

### API Keys

#### `GET /api-keys`
#### `POST /api-keys`
```json
{
  "name": "string",
  "project_id": "uuid (optional, null = all projects)",
  "scopes": ["read", "write", "admin"]
}
```
The `key` field (`tdp_...`) is only returned on creation. Store it securely.

#### `PATCH /api-keys/{id}`
```json
{ "name": "string (optional)", "active": true/false, "scopes": [...] }
```
#### `DELETE /api-keys/{id}`

---

### Activity

#### `GET /activity`
Query parameters:
- `limit` — number of entries (default 50, max 200)
- `project_id` — filter by project

```json
[
  {
    "id": "uuid",
    "project_id": "uuid | null",
    "task_id": "uuid | null",
    "action": "task.created | task.status_changed | task.deleted | project.created | ...",
    "actor": "string | null",
    "detail": "human-readable string",
    "meta": { "old_status": "todo", "new_status": "done" },
    "created_at": "ISO 8601"
  }
]
```

---

### Inbound Webhook

#### `POST /webhook/callback/{callback_token}`
No authentication required. `callback_token` is the task's unique webhook identifier.

```json
// Request
{ "status": "todo | in_progress | done | failed", "message": "optional string" }

// Response 200
{ "ok": true, "task_id": "uuid", "status": "done" }

// Response 404 — token not found
{ "detail": "Task not found" }
```

---

## External API v1

Base path: `/api/v1`

**Authentication**: `X-API-Key: tdp_your_key` header

**Scopes**:
- `read` — GET endpoints
- `write` — POST, PATCH, DELETE on tasks; send email
- `admin` — all of the above + DELETE projects

A project-scoped key only accesses tasks within that project.

---

### Projects

#### `GET /api/v1/projects`
Returns projects accessible to the API key.

#### `GET /api/v1/projects/{id}`
Returns project with full task list.

#### `POST /api/v1/projects` — requires `write`
#### `PATCH /api/v1/projects/{id}` — requires `write`
#### `DELETE /api/v1/projects/{id}` — requires `admin`

---

### Tasks

#### `GET /api/v1/projects/{pid}/tasks`
Query parameters:
- `status_filter` — comma-separated statuses (e.g., `todo,in_progress`)
- `priority` — `low | medium | high`

#### `GET /api/v1/projects/{pid}/tasks/{tid}`

#### `POST /api/v1/projects/{pid}/tasks` — requires `write`
Same schema as internal API. Status changes fire outbound notifications.

#### `PATCH /api/v1/projects/{pid}/tasks/{tid}` — requires `write`

#### `DELETE /api/v1/projects/{pid}/tasks/{tid}` — requires `write`

#### `POST /api/v1/projects/{pid}/tasks/bulk` — requires `write`
```json
// Request — array of task objects
[{ "title": "...", "status": "todo", ... }, ...]

// Response
{ "created": 5, "tasks": [...] }
```

#### `POST /api/v1/projects/{pid}/tasks/bulk-update` — requires `write`
```json
// Request — each item must include "id"
[{ "id": "uuid", "status": "done" }, ...]

// Response
{ "updated": 3, "tasks": [...] }
```

---

### Stats & Summary

#### `GET /api/v1/projects/{pid}/stats`
```json
{
  "project_id": "uuid",
  "project_name": "string",
  "total": 10,
  "by_status": { "todo": 3, "in_progress": 2, "done": 4, "failed": 1 },
  "by_priority": { "high": 2, "medium": 5, "low": 3 },
  "completion_pct": 40.0,
  "overdue_count": 1
}
```

#### `GET /api/v1/summary`
High-level platform snapshot optimized for AI agents.

```json
{
  "generated_at": "ISO 8601",
  "overall": {
    "total_projects": 5,
    "active_projects": 4,
    "total_tasks": 42,
    "done_tasks": 28,
    "completion_rate": 66.7
  },
  "by_identity": [
    {
      "id": "uuid", "name": "string", "color": "#hex",
      "project_count": 2, "total_tasks": 15, "done_tasks": 10, "progress": 66.7
    }
  ],
  "by_project": [
    {
      "id": "uuid", "name": "string", "status": "active",
      "progress": 75.0, "total_tasks": 4, "done_tasks": 3,
      "active_tasks": 1, "assignees": ["alice"], "next_due": "ISO 8601 | null"
    }
  ],
  "recent_activity": [...]
}
```

---

### Email

#### `GET /api/v1/email/status`
```json
{ "configured": true, "smtp_host": "smtp.example.com", "from": "notify@example.com" }
```

#### `POST /api/v1/email/send` — requires `write`
```json
// Request
{
  "to": ["a@example.com"],
  "subject": "string",
  "html": "<p>...</p>",
  "text": "plain text (optional)"
}
```

---

### Activity (External API)

#### `GET /api/v1/activity`
Query parameters: `project_id`, `limit` (default 50)

---

## Events Reference

| Event | Fired when |
|---|---|
| `task.done` | Task status changes to `done` |
| `task.failed` | Task status changes to `failed` |
| `task.in_progress` | Task status changes to `in_progress` |
| `task.created` | New task created |
| `project.complete` | All tasks in a project reach `done` |

## Notification Payload

Sent to all matching active integrations:

```json
{
  "event": "task.done",
  "project": {
    "id": "uuid",
    "name": "string",
    "status": "active",
    "progress": 100.0,
    "total_tasks": 4,
    "done_tasks": 4
  },
  "task": {
    "id": "uuid",
    "title": "string",
    "status": "done",
    "priority": "high"
  },
  "timestamp": "2026-03-21T10:00:00Z"
}
```

Additional headers per integration type:
- Drone: `X-Drone-Event: custom`
- Jenkins: `X-Jenkins-Source: todo-platform`
- With secret: `Authorization: Bearer {secret}`
