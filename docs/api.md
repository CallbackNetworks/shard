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

### Comments

#### `GET /projects/{pid}/tasks/{tid}/comments`
Returns all comments for a task, ordered by creation date ascending.

#### `POST /projects/{pid}/tasks/{tid}/comments`
```json
// Request
{ "author": "string (optional)", "body": "string (markdown)" }

// Response 201
{
  "id": "uuid",
  "task_id": "uuid",
  "project_id": "uuid",
  "author": "string | null",
  "body": "string",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

#### `PATCH /projects/{pid}/tasks/{tid}/comments/{cid}`
```json
{ "body": "updated markdown text" }
```

#### `DELETE /projects/{pid}/tasks/{tid}/comments/{cid}`

---

### Recurrence Rules

Manage recurring task schedules. The scheduler automatically clones the template task based on the configured frequency.

#### `GET /projects/{pid}/tasks/{tid}/recurrence`
Returns the recurrence rule for the task, or `404` if none exists.

```json
{
  "id": "uuid",
  "template_task_id": "uuid",
  "frequency": "daily | weekly | monthly | interval",
  "interval_value": 1,
  "day_of_week": null,
  "day_of_month": null,
  "next_run_at": "ISO 8601",
  "last_run_at": "ISO 8601 | null",
  "end_date": "ISO 8601 | null",
  "active": true,
  "created_at": "ISO 8601"
}
```

#### `POST /projects/{pid}/tasks/{tid}/recurrence`
```json
// Request
{
  "frequency": "daily | weekly | monthly | interval",
  "interval_value": 1,
  "day_of_week": 0,
  "day_of_month": null,
  "next_run_at": "ISO 8601",
  "end_date": "ISO 8601 (optional)",
  "active": true
}

// Response 201 — recurrence rule
// Response 409 — rule already exists (use PATCH to update)
```

**Frequency options:**
- `daily` — every day
- `weekly` — on `day_of_week` (0=Mon … 6=Sun)
- `monthly` — on `day_of_month` (1–31)
- `interval` — every `interval_value` days

#### `PATCH /projects/{pid}/tasks/{tid}/recurrence`
Same fields as POST, all optional.

#### `DELETE /projects/{pid}/tasks/{tid}/recurrence`

---

### Attachments

#### `GET /projects/{pid}/tasks/{tid}/attachments`
Returns all attachments for a task.

```json
[
  {
    "id": "uuid",
    "task_id": "uuid",
    "project_id": "uuid",
    "filename": "report.pdf",
    "content_type": "application/pdf",
    "size": 204800,
    "created_at": "ISO 8601"
  }
]
```

#### `POST /projects/{pid}/tasks/{tid}/attachments`
Upload a file. Send as `multipart/form-data` with field name `file`. Max file size: **20 MB**.

```bash
curl -X POST http://localhost:8000/projects/{pid}/tasks/{tid}/attachments \
  -H "Authorization: Bearer {token}" \
  -F "file=@report.pdf"
```

#### `GET /projects/{pid}/tasks/{tid}/attachments/{aid}/download`
Returns the file as a download.

#### `DELETE /projects/{pid}/tasks/{tid}/attachments/{aid}`

---

### Search

#### `GET /search`
Full-text search across tasks and projects using case-insensitive LIKE matching.

Query parameters:
- `q` (required) — search query (min length 1)
- `project_id` — limit to a specific project
- `limit` — max results (default 50, max 200)
- `offset` — pagination offset (default 0)

```json
{
  "query": "deploy",
  "tasks": [
    {
      "id": "uuid",
      "title": "Deploy to production",
      "status": "todo",
      "priority": "high",
      "labels": [...],
      "subtask_count": 2,
      "comment_count": 1,
      "blocked_by": [],
      "blocking": []
    }
  ],
  "projects": [
    {
      "id": "uuid",
      "name": "Deployment Pipeline",
      "status": "active",
      "total_tasks": 10,
      "done_tasks": 7,
      "progress": 70.0
    }
  ]
}
```

---

### Analytics

#### `GET /analytics/overview`
Platform-wide statistics.

```json
{
  "total_projects": 5,
  "active_projects": 4,
  "total_tasks": 42,
  "done_tasks": 28,
  "in_progress_tasks": 8,
  "overdue_tasks": 2,
  "most_active_project": { "id": "uuid", "name": "string", "activity_count": 15 }
}
```

#### `GET /analytics/heatmap`
Activity frequency per day (GitHub-style contribution heatmap data).

Query parameters:
- `start` — start date `YYYY-MM-DD` (default: 365 days ago)
- `end` — end date `YYYY-MM-DD` (default: today)
- `project_id` — filter by project

```json
[
  { "date": "2026-03-15", "count": 8 },
  { "date": "2026-03-16", "count": 3 }
]
```

#### `GET /analytics/burndown`
Burn-down chart data for a cycle.

Query parameters:
- `cycle_id` (required)

```json
[
  { "date": "2026-03-01", "remaining": 10, "done": 0 },
  { "date": "2026-03-02", "remaining": 8, "done": 2 }
]
```

#### `GET /analytics/velocity`
Completed tasks per cycle for a project. Only includes completed cycles.

Query parameters:
- `project_id` (required)

```json
[
  {
    "cycle_id": "uuid",
    "name": "Sprint 1",
    "total_tasks": 10,
    "completed_tasks": 8,
    "start_date": "ISO 8601",
    "end_date": "ISO 8601"
  }
]
```

#### `GET /analytics/cycle-burndown`
Detailed burn-down for a cycle with ideal line.

Query parameters:
- `cycle_id` (required)

```json
[
  { "date": "2026-03-01", "remaining": 10, "total": 10, "done": 0, "ideal": 10.0 },
  { "date": "2026-03-02", "remaining": 8, "total": 10, "done": 2, "ideal": 8.0 }
]
```

#### `GET /analytics/status-trend`
Daily task count breakdown by status over time.

Query parameters:
- `project_id` — filter by project
- `days` — number of days (default 30, max 365)

```json
[
  { "date": "2026-03-15", "todo": 5, "in_progress": 3, "done": 10, "failed": 1 }
]
```

---

### Task Templates

#### `GET /templates`
Query parameters:
- `project_id` — filter by project (also includes global templates)

```json
[
  {
    "id": "uuid",
    "name": "Bug Report",
    "description": "Standard bug report template",
    "priority": "medium",
    "subtasks": [{ "title": "Reproduce" }, { "title": "Fix" }, { "title": "Test" }],
    "label_names": ["bug"],
    "project_id": "uuid | null",
    "created_at": "ISO 8601"
  }
]
```

#### `POST /templates`
```json
{
  "name": "string",
  "description": "string (optional)",
  "priority": "low | medium | high (default: medium)",
  "subtasks": [{ "title": "..." }],
  "label_names": ["bug", "frontend"],
  "project_id": "uuid (optional, null = global)"
}
```

#### `DELETE /templates/{id}`

---

### Workflow Rules

#### `GET /workflow-rules`
Query parameters:
- `project_id` — filter by project (also includes global rules)

```json
[
  {
    "id": "uuid",
    "name": "Auto-assign high priority",
    "project_id": "uuid | null",
    "trigger": "task.created",
    "conditions": [{ "field": "priority", "op": "eq", "value": "high" }],
    "actions": [{ "type": "set_assignee", "value": "alice" }],
    "active": true,
    "run_count": 42,
    "last_run_at": "ISO 8601 | null",
    "created_at": "ISO 8601"
  }
]
```

#### `POST /workflow-rules`
```json
{
  "name": "string",
  "project_id": "uuid (optional, null = global)",
  "trigger": "task.created | task.status_changed | task.label_added | task.priority_changed",
  "conditions": [
    { "field": "priority | status | title_contains | has_label | assignee", "op": "eq | neq | contains | in", "value": "string or array" }
  ],
  "actions": [
    { "type": "set_status | set_priority | set_assignee | add_label | remove_label | add_comment | fire_event", "value": "string" }
  ],
  "active": true
}
```

#### `GET /workflow-rules/{id}`
#### `PATCH /workflow-rules/{id}`
Same fields as POST, all optional.

#### `DELETE /workflow-rules/{id}`

#### `POST /workflow-rules/{id}/test?task_id={tid}`
Dry-run: check which actions would fire for a given task without executing them.

```json
{
  "would_fire": true,
  "conditions_met": [true, true],
  "actions": [{ "type": "set_assignee", "value": "alice" }]
}
```

---

### Webhook Delivery Logs

#### `GET /integrations/{id}/deliveries`
Query parameters:
- `status` — filter by delivery status (`pending`, `success`, `failed`, `dead`)
- `limit` — max results (default 50, max 200)
- `offset` — pagination offset

```json
[
  {
    "id": "uuid",
    "integration_id": "uuid",
    "event": "task.done",
    "payload": { ... },
    "request_url": "https://...",
    "request_headers": { ... },
    "attempt": 1,
    "status": "success",
    "status_code": 200,
    "response_body": "OK",
    "error": null,
    "next_retry_at": null,
    "delivered_at": "ISO 8601"
  }
]
```

#### `GET /deliveries/{id}`
Get a single delivery record with full details.

#### `POST /deliveries/{id}/retry`
Manually retry a failed or dead delivery. Resets the attempt counter.

#### `DELETE /deliveries?older_than_days=30`
Purge old delivery records. Default: older than 30 days.

---

### LLM Assistant

#### `GET /assistant/conversations`
Query parameters:
- `q` — search conversations by title or message content

Returns the 20 most recent conversations.

#### `POST /assistant/conversations`
Creates a new conversation.

#### `GET /assistant/conversations/{id}`
Returns conversation with full message history.

#### `DELETE /assistant/conversations/{id}`

#### `POST /assistant/conversations/{id}/messages`
Send a message and receive an SSE stream response.

```json
// Request
{ "content": "What tasks are overdue?" }
```

**SSE events:**
```
data: {"type": "text", "text": "Looking at your..."}
data: {"type": "tool_start", "name": "list_tasks", "input": {...}}
data: {"type": "tool_result", "name": "list_tasks", "result": "..."}
data: {"type": "done"}
data: {"type": "error", "message": "..."}   // on failure
```

---

### Share (Public)

No authentication required. Rate-limited.

#### `GET /share/identity/{share_token}`
Returns public read-only data for the identity: projects, tasks, recent activity, and summary stats.

If the identity has a PIN set and no valid session cookie, returns a partial response with `meta.requires_pin: true`.

If the share link has expired, returns `410 Gone`.

```json
{
  "identity": { "id": "uuid", "name": "string", "color": "#hex", "avatar": "string", "description": "string" },
  "projects": [
    {
      "id": "uuid", "name": "string", "status": "active",
      "total_tasks": 10, "done_tasks": 7, "progress": 70.0,
      "labels": [{ "name": "bug", "color": "#hex" }],
      "active_cycle": { "name": "Sprint 1", "total_tasks": 5, "done_tasks": 3, "progress": 60.0 },
      "comment_count": 15,
      "tasks": [
        { "id": "uuid", "title": "string", "status": "todo", "priority": "high", "assignee": "string",
          "due_date": "ISO 8601", "labels": [...], "subtask_count": 2, "comment_count": 1 }
      ]
    }
  ],
  "recent_activity": [...],
  "summary": {
    "total_projects": 3, "total_tasks": 25, "done_tasks": 18,
    "overdue_tasks": 1, "overall_progress": 72.0
  },
  "meta": { "generated_at": "ISO 8601", "requires_pin": false }
}
```

#### `POST /share/identity/{share_token}/verify`
Verify the PIN for a protected share link. Sets a session cookie (15-minute TTL).

```json
// Request
{ "pin": "1234" }

// Response 200 — full share data (same as GET above)
// Response 403 — invalid PIN
```

---

### Identity Share Management (Internal API)

These endpoints manage share settings for identities (require auth).

#### `POST /identities/{id}/rotate-share-token`
Generate a new share token. The old share URL stops working.

```json
{ "share_token": "new-uuid" }
```

#### `POST /identities/{id}/set-pin`
Set a 4–6 digit PIN to protect the share link.

```json
// Request
{ "pin": "1234" }
```

#### `DELETE /identities/{id}/pin`
Remove PIN protection from the share link.

#### `POST /identities/{id}/set-expiry`
Set an expiration date for the share link.

```json
// Request
{ "expires_at": "ISO 8601 | null" }
```

#### `GET /identities/{id}/share-views`
Get the total view count for the identity's share page.

```json
{ "view_count": 42 }
```

---

### WebSocket

#### `WS /ws`
Real-time event stream. No authentication required (relies on same-origin).

Events broadcast after mutations:
- `task.created`, `task.updated`, `task.deleted`
- `project.created`, `project.updated`, `project.deleted`

Message format:
```json
{ "event": "task.updated", "data": { ... } }
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
- Jenkins: `X-Jenkins-Source: shard`
- With secret: `Authorization: Bearer {secret}`
