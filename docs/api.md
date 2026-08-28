# API Reference

The platform exposes two APIs:

- **Internal API** — used by the web UI, protected by the session Bearer token. Mounted under the `/api` prefix (ADR-0036)
- **External API v1** — for scripts and AI agents, authenticated via `X-API-Key` header. Mounted under `/api/v1`

Interactive docs (Swagger UI) are always available at `http://localhost:8000/docs`.

## The single write surface

Every first-class entity — task, project, label, cycle, goal, identity, and any user-defined
type — is a **node** in one graph; relationships between them are **edges** (ADR-0032/0033).
Consequently there is exactly one way to create, update, or delete an entity on each API,
and it is the same shape on both:

| | Internal | External v1 |
|---|---|---|
| Create | `POST /api/nodes` | `POST /api/v1/nodes` |
| Update | `PATCH /api/nodes/{id}` | `PATCH /api/v1/nodes/{id}` |
| Delete | `DELETE /api/nodes/{id}` | `DELETE /api/v1/nodes/{id}` |
| Link/unlink | `POST`/`DELETE /api/nodes/{id}/edges` | `POST`/`DELETE /api/v1/nodes/{id}/edges` |

The per-entity write routes that used to exist (`POST /projects`, `POST /projects/{pid}/tasks`,
`POST /projects/{pid}/labels`, `POST /identities`, …) were retired across ADR-0040 → ADR-0043
and now return **405**. What remains under `/projects/{pid}/...` is **reads**, **relationship
sub-resources** (labels, dependencies, memberships, cycle assignment, recurrence, attachments,
comments), and **operations** (reorder, bulk-update, import/export, regenerate-token).

Writes are dispatched by the target node's **roles** rather than by URL (ADR-0040), so a task
created through `/api/nodes` fires exactly the same activity log, workflow rules, outbound
notifications, and WebSocket broadcast as one created any other way.

---

## Internal API

All endpoints require `Authorization: Bearer {token}` when `AUTH_PASSWORD` is set. Token is obtained via `POST /api/auth/login`.

All paths in this section are relative to the `/api` prefix — `GET /projects` means
`GET /api/projects`. Root-level paths (`/webhook`, `/share`, `/ical`, `/ws`, `/health`,
`/api/v1`) are external contracts and are documented with their full path.

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

#### `POST /auth/logout`
Invalidate the current session token.

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

#### `GET /projects/{id}`
Returns project with full task list including subtasks, labels, and cycle assignments.

#### Creating / updating / deleting a project
Use the node surface — a project is `Node(type="project")`:

```json
// POST /nodes
{ "type": "project", "title": "string", "data": { "description": "string (optional)" } }

// PATCH /nodes/{id}
{ "title": "string (optional)", "status": "active | archived (optional)" }

// DELETE /nodes/{id}
// Container-role cascade (ADR-0043): deletes exclusively-owned tasks and the
// project's labels and cycles. A task also linked into another project is only
// unlinked from this one.
```

---

### Tasks

#### `GET /projects/{pid}/tasks`
Returns all tasks in the project including subtasks and assigned labels.

#### `GET /tasks/unfiled`
Tasks belonging to no project (ADR-0032/0033) — the unfiled bucket.

#### Creating / updating / deleting a task
Use the node surface — a task is `Node(type="task")`. `container_id` files it under a project
(or any container-role node: goal, custom container); `parent_id` makes it a subtask.

```json
// POST /nodes
{
  "type": "task",
  "title": "string",
  "container_id": "uuid (project/goal/custom container)",
  "parent_id": "uuid (optional, for subtasks)",
  "status": "todo | in_progress | done | failed (default: todo)",
  "priority": "low | medium | high (default: medium)",
  "assignee": "string (optional)",
  "start_date": "ISO 8601 (optional)",
  "due_date": "ISO 8601 (optional)",
  "data": { "description": "string (optional, markdown)" }
}

// Response 201 — enriched TaskOut, same shape the retired task route returned
{
  "id": "uuid",
  "callback_token": "uuid",  // use this for the webhook URL
  "project_id": "uuid | null",
  "subtask_count": 0,
  "comment_count": 0,
  "blocked_by": [], "blocking": [],
  ...
}
```

`PATCH /nodes/{id}` takes the same fields, all optional; passing `parent_id` re-parents the
task (a graph move — 404 if the new parent is outside the project, 400 if it would create a
containment cycle). `DELETE /nodes/{id}` tears down the subtask tree and peripheral rows.

Status changes fire the activity trail, workflow rules, and outbound notifications.

#### `POST /projects/{pid}/tasks/{tid}/regenerate-token`
Generates a new `callback_token`. The old webhook URL stops working immediately.

```json
{ "callback_token": "new_uuid" }
```

#### `GET /nodes/{id}/webhook`
The credentials a CI provider needs to call back into this task (ADR-0060). A request of
its own rather than fields on the task, because the signing secret never rides along in a
task payload (ADR-0059) — and reading it is recorded in the activity trail.

```json
{ "callback_token": "uuid", "secret": "64 hex chars", "path": "/webhook/callback/uuid" }
```

A path rather than a URL: behind a reverse proxy the server's idea of its own origin is
whatever the last hop told it, while the client asking already knows the real one.
`400` if the node's type does not receive callbacks.

#### `POST /nodes/{id}/webhook/rotate-secret`
Issues a new signing secret and returns the same shape. Callbacks signed with the old
secret are rejected from that moment on.

#### `POST /projects/{pid}/tasks/{tid}/create-external-issue`
Create a GitHub/GitLab/Gitea issue from this task and link it (ADR-0026). Provider is
auto-detected from the project's `repo_url` when omitted.

```json
{ "provider": "github | gitlab (optional)" }
```

---

### Task Relationships

Dependencies and multi-project membership are graph edges; these are the task-scoped
conveniences over them.

#### `POST /projects/{pid}/tasks/{tid}/dependencies/{depends_on_id}`
#### `DELETE /projects/{pid}/tasks/{tid}/dependencies/{depends_on_id}`
Adds/removes a `depends_on` edge. Rejected (400) if it would create a dependency cycle.

#### `POST /projects/{pid}/tasks/{tid}/memberships/{target_pid}`
#### `DELETE /projects/{pid}/tasks/{tid}/memberships/{target_pid}`
Links a task into an additional project (ADR-0032). Memberships are symmetric — there is no
primary project — and a task may legally reach zero, becoming *unfiled*.

#### `POST /tasks/{tid}/memberships/{pid}`
The unscoped form: files a task into a project without requiring a source project. This is
how an unfiled task gets its first project. Idempotent.

---

### Labels

#### `GET /projects/{pid}/labels`

#### Creating / deleting a label
A label is `Node(type="label")` scoped to its project by a `contains` edge:

```json
// POST /nodes
{ "type": "label", "title": "string", "container_id": "<project id>",
  "data": { "color": "#hex (optional, default #5e6ad2)" } }

// DELETE /nodes/{label_id}
```

A decision record used to be one of these, wearing `data.type = "decision"` (ADR-0004). It is
its own node type since ADR-0118 — see [Decisions](#decisions) below.

#### `POST /projects/{pid}/tasks/{tid}/labels/{lid}`
Assigns a label to a task.

#### `DELETE /projects/{pid}/tasks/{tid}/labels/{lid}`

---

### Cycles

#### `GET /projects/{pid}/cycles`
#### `GET /projects/{pid}/cycles/{cid}`
Returns cycle with its task list.

#### `GET /projects/{pid}/cycles/{cid}/compare?compare_with={cid2}`
Side-by-side stats for two cycles.

#### Creating / updating / deleting a cycle
A cycle is `Node(type="cycle")` scoped to its project by a `contains` edge. `end_date` maps
to the node's `due_date`:

```json
// POST /nodes
{ "type": "cycle", "title": "string", "container_id": "<project id>",
  "status": "draft | active | completed (default: draft)",
  "start_date": "ISO 8601 (optional)",
  "due_date": "ISO 8601 (optional, the cycle end date)",
  "data": { "description": "string (optional)" } }

// PATCH /nodes/{cycle_id}    // DELETE /nodes/{cycle_id}
```

#### `POST /projects/{pid}/cycles/{cid}/tasks/{tid}`
Adds a task to a cycle.

#### `DELETE /projects/{pid}/cycles/{cid}/tasks/{tid}`

#### `POST /projects/{pid}/cycles/{cid}/duplicate`
Clones the cycle as a new draft, with its tasks re-created as fresh `todo` tasks.

---

### Integrations

#### `GET /integrations`

#### `GET /integrations/events`
The event vocabulary that can be subscribed to. Served rather than hardcoded in the UI so
the checkbox list cannot drift from what the notifier delivers (ADR-0047). See
[Events Reference](#events-reference).

#### `POST /integrations`
```json
{
  "name": "string",
  "type": "jenkins | drone | generic | email",
  "url": "string (webhook URL; empty for email type)",
  "secret": "string (optional, sent as Bearer token)",
  "project_id": "uuid (optional, null = global — receives events from every project)",
  "events": ["task.done", "task.failed", "task.in_progress", "project.complete"],
  // An event outside GET /integrations/events is rejected with 422
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

#### `GET /integrations/templates` · `GET /integrations/templates/{id}`
Pre-built integration configurations (Slack, Discord, …) to start from.

#### `GET /integrations/{id}/health`
Delivery success rate and recent failure summary for one integration.

#### `POST /integrations/{id}/retry-all`
Re-queue every failed delivery for this integration.

---

### Identities

#### `GET /identities`
#### `GET /identities/hub-stats`
Aggregate per-identity workload stats for the identity hub.

#### Creating / updating / deleting an identity
An identity is a top-level `Node(type="identity")` — no container. Creation seeds a
`share_token` automatically (every shareable-role type does, ADR-0041):

```json
// POST /nodes
{ "type": "identity", "title": "string",
  "data": { "color": "#hex", "description": "string (optional)", "avatar": "emoji or char (optional)" } }

// PATCH /nodes/{identity_id}    // DELETE /nodes/{identity_id}
```

#### Linking a project to an identity
Ownership is an `owns` edge **from the identity to the project** — source is the owner
(ADR-0078). Not `contains`: that is where a node lives, and an identity is not a place.

```json
// POST /nodes/{identity_id}/edges
{ "target_id": "<project id>", "rel_type": "owns" }

// DELETE /nodes/{identity_id}/edges?target_id=<project id>&rel_type=owns
```

#### `GET /identities/{id}/projects`
Returns projects linked to the identity (used by the public status page).

#### `GET /nodes/{id}/share-views`
Share-page access audit (ADR-0025). One endpoint for every shareable-role node — the
identity- and project-specific routes were collapsed onto it by ADR-0070 → ADR-0073.
The view count matches rows written under any of the older subject columns, so
retiring those routes did not retire their history.

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
The `key` field (`tdp_...`) is only returned on creation. Store it securely — only its
SHA-256 hash and last four characters are kept, so a lost key can be rotated but never
recovered.

#### `POST /api-keys/{id}/rotate`
Issue a new secret for an existing key, keeping its name, scopes and container. The previous
secret stops working immediately and `last_used_at` resets — a fresh secret has no usage
history of its own. The new value is returned once, like creation.

#### `PATCH /api-keys/{id}`
```json
{ "name": "string (optional)", "active": true/false, "scopes": [...] }
```
#### `DELETE /api-keys/{id}`

#### `GET /api-keys/agents/summary`
Per-agent-key activity summary: what each agent key has been assigned and touched.

---

### Activity

#### `GET /activity-watches` · `POST /activity-watches` · `DELETE /activity-watches/{id}`
Curves a user registered on the activity ticker (ADR-0105). A watch is either one node
(`kind="node"`, `target_id`) or every node of a type (`kind="node_type"`, `target_type`).
No column is added to `activity_logs` — matching resolves against the live `nodes` table at
read time.

```json
{ "kind": "node_type", "target_type": "task", "label": "Tasks", "color": "#hex" }
```

#### `GET /focus-targets`
Everything the sidebar's Focus control can narrow to. Registry-driven rather than
identity-only, so a user-defined container layer above identity is offered too (ADR-0081).

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

#### `GET /analytics/critical-path/{project_id}`
Longest dependency chain through the project — the tasks that actually gate completion.

#### `GET /analytics/estimation-calibration`
How past estimates compared with actual time spent.

#### `GET /analytics/estimate-suggestion?title=&label_ids=`
Suggested time estimate for a new task, derived from comparable finished tasks (ADR-0028).

#### `GET /analytics/usage` · `DELETE /analytics/usage`
API usage tracking per key/endpoint, and purge.

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

#### `PATCH /templates/{id}`
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
    "trigger": "node.created",
    "conditions": [{ "field": "priority", "op": "eq", "value": "high" }],
    "actions": [{ "type": "set_assignee", "value": "alice" }],
    "active": true,
    "run_count": 42,
    "effect_count": 12,
    "last_run_at": "ISO 8601 | null",
    "created_at": "ISO 8601",
    "warnings": [
      { "type": "add_label", "value": "security", "outcome": "skipped", "reason": "label_not_found" }
    ]
  }
]
```

`run_count` is how many times the rule fired; `effect_count` is how many of those runs
changed anything (ADR-0053). A rule with `run_count` high and `effect_count` 0 is firing
constantly and doing nothing — every action is a no-op or a skip.

`warnings` lists the actions that cannot work for **any** subject — a label no project
has, an event no integration subscribes to (ADR-0054). Computed per request rather than
stored, because the condition is about the world and not about the rule: create the label
and the warning disappears on the next read. It is never a reason to reject a write; a
global rule that is dead in one project is alive in another. Same record shape as an
execution outcome, so the same UI renders both.

Each run writes a `rule.executed` activity entry whose `meta` carries the per-action
outcome:

```json
{
  "action": "rule.executed",
  "detail": "Rule \"R\" ran on task \"T\" with no effect: priority already high; fired \"deploy.requested\" to no subscriber",
  "meta": {
    "rule_id": "uuid",
    "rule_name": "R",
    "trigger": "node.created",
    "node_id": "uuid",
    "effect_count": 0,
    "actions": [
      { "type": "set_priority", "value": "high", "outcome": "no_op", "reason": "unchanged" },
      { "type": "fire_event", "value": "deploy.requested", "outcome": "no_op", "reason": "no_subscribers", "subscribers": 0 }
    ]
  }
}
```

`outcome` is one of `applied` (ran and changed something), `no_op` (ran correctly and
changed nothing), `skipped` (could not run — also written as its own `rule.skipped`
entry), or `failed` (raised — written as `rule.failed`).

#### `POST /workflow-rules`
```json
{
  "name": "string",
  "project_id": "uuid (optional, null = global)",
  "trigger": "node.created | node.updated | node.deleted | edge.added | edge.removed",
  "conditions": [
    { "field": "priority | status | title_contains | has_label | assignee | type | has_role | changed_field | edge_type | edge_side | other_type", "op": "eq | neq | contains | in", "value": "string or array" }
  ],
  "actions": [
    { "type": "set_status | set_priority | set_assignee | add_label | remove_label | add_comment | fire_event", "value": "string" }
  ],
  "active": true
}
```

#### `GET /workflow-rules/vocabulary`
Query: `project_id` (optional — narrows the label suggestions to one project).

Everything the rule editor needs to render itself. It renders whatever this returns
rather than keeping its own copy, so anything the UI offers is by construction something
the engine understands (ADR-0048, ADR-0049).

```json
{
  "triggers": ["node.created", "node.updated", "node.deleted", "edge.added", "edge.removed"],
  "trigger_context_fields": {
    "node.created": [],
    "node.updated": ["changed_field"],
    "node.deleted": [],
    "edge.added": ["edge_side", "edge_type", "other_type"],
    "edge.removed": ["edge_side", "edge_type", "other_type"]
  },
  "condition_fields": ["assignee", "changed_field", "edge_side", "edge_type", "has_label", "has_role", "other_type", "priority", "status", "title_contains", "type"],
  "condition_ops": ["contains", "eq", "in", "neq"],
  "action_types": ["add_comment", "add_label", "fire_event", "remove_label", "set_assignee", "set_priority", "set_status"],
  "action_values": {
    "add_comment": { "kind": "free", "options": [] },
    "add_label": { "kind": "suggest", "options": ["urgent", "security"] },
    "fire_event": { "kind": "suggest", "options": ["task.done", "deploy.requested"], "subscribers": { "task.done": 2, "deploy.requested": 0 } },
    "set_status": { "kind": "enum", "options": ["todo", "in_progress", "done", "failed"] }
  },
  "condition_values": {
    "edge_side": { "kind": "enum", "options": ["source", "target"] },
    "has_label": { "kind": "suggest", "options": ["urgent", "security"] },
    "has_role": { "kind": "enum", "options": ["container", "task", "shareable", "subscribable"] },
    "title_contains": { "kind": "free", "options": [] }
  },
  "task_only_actions": ["add_comment", "add_label", "remove_label", "set_assignee", "set_priority", "set_status"]
}
```

Any trigger, condition field, op or action type outside these lists is rejected with 422
at write time.

`action_values` / `condition_values` say what may go in a rule's **value** (ADR-0056) —
one entry per action type and per condition field, so a value box is never a bare text
input with no clue what to type. Three kinds:

| `kind` | Meaning | Control |
|--------|---------|---------|
| `enum` | closed; the write surface rejects anything else | a picker. `options` order is meaningful (`todo → failed`, `low → high`), not alphabetical |
| `suggest` | open, but there is something real to offer (labels that exist, subscribable events, registered relation keys) | a text box with the options attached — a value outside them is legal and may become valid later, which is why the miss is a *warning*, not a 422 |
| `free` | a comment body, a person's name — nothing to offer | a plain text box |

`fire_event` additionally carries `subscribers`: how many active integrations would
receive each event. It is the one action whose effect lands elsewhere entirely, and an
event nobody subscribes to is delivered to nobody — the count says so while the rule is
still being written, rather than after it has fired into the void.

**Every trigger fires for every node type** (ADR-0049, ADR-0055). Narrow one with a
`has_role eq task` condition, or `type eq <type_key>` for one specific type. Actions in
`task_only_actions` are skipped (and logged as `rule.skipped`) when the node they land on
has no task role.

The last four condition fields describe **the change**, not the subject, and only some
triggers supply them — that is what `trigger_context_fields` lists. A rule using one its
trigger does not carry is rejected with 422 (not warned about: `node.created` will never
carry a `changed_field`, so the rule contradicts itself).

| Trigger | Fires when | Subject |
|---------|-----------|---------|
| `node.created` | any node is created | the new node |
| `node.updated` | one or more fields actually move — a write echoing the current value back is not a change | the updated node; `changed_field` holds the whole set, so one edit touching two fields runs a matching rule once |
| `node.deleted` | before the teardown, while the subject still exists | the node being deleted; every action but `fire_event` is skipped with reason `node_deleted`, because a write to a node on its way out is one nobody will ever read |
| `edge.added` / `edge.removed` | any relationship is written or dropped | **each endpoint in turn** — `edge_side` is `source` or `target`, `other_type` is the type at the far end. A rule with no conditions therefore runs twice for one edge |

Edges that disappear because their node was deleted do not fire `edge.removed`;
`node.deleted` is the event that covers them.

The task-shaped triggers this replaces map onto conditions: `task.status_changed` is
`node.updated` + `changed_field eq status`, and `task.label_added` is `edge.added` +
`edge_type eq labeled`. Existing rules were rewritten into that form by migration
`c2e4a6b8d0f1`, which also added `has_role eq task` so a rule written for tasks does not
start running against projects and labels.

#### `GET /workflow-rules/{id}`
#### `PATCH /workflow-rules/{id}`
Same fields as POST, all optional.

#### `DELETE /workflow-rules/{id}`

#### `POST /workflow-rules/{id}/test?node_id={nid}`
Dry-run one rule against one node, without executing anything. `task_id` is accepted as a
deprecated alias for `node_id`; any node works, not only a task (ADR-0049).

```json
{
  "would_fire": true,
  "conditions_met": [true, true],
  "node": { "id": "uuid", "type": "task", "title": "Fix login bug" },
  "actions": [
    { "type": "set_assignee", "value": "alice", "outcome": "applied", "from": null },
    { "type": "add_label", "value": "security", "outcome": "skipped", "reason": "label_not_found" }
  ],
  "effect_count": 1
}
```

`actions` used to be the rule's own `actions` echoed back, which said "would fire" for
actions the engine skips every time. Each one is now put through the engine's own
prediction, so a dry-run reports the same four-value `outcome` an execution records and
cannot promise something the engine would not do (ADR-0054). `would_fire` answers only
whether the conditions match; `effect_count` answers how many actions would change
anything. Empty `actions` when `would_fire` is `false`.

`would_fire` and each entry of `conditions_met` are **tri-state**: `true`, `false`, or
`null`. A subject is not an event, so a condition about the change that fires the rule
(`changed_field`, `edge_type`, `edge_side`, `other_type`) has no answer here and reports
`null` rather than `false` — calling it unmet would make every `node.updated` rule report
"would not fire", the same false report as the pre-ADR-0054 dry-run in the opposite
direction. `false` beats `null` beats `true`: one definitely-unmet condition settles it,
otherwise an undecidable one leaves the answer open and the action predictions are still
returned (ADR-0055).

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

#### `GET /deliveries`
All deliveries across every integration; same query parameters as above.

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

#### `GET /share/node/{share_token}`
The one public share endpoint (ADR-0070, ADR-0071). Dispatches on the token's node type: an
identity aggregates the projects it holds through `owns`, a project serves itself, any
other shareable container serves its `contains` subtree. Returns public read-only data:
projects, tasks, recent activity, and summary stats.

The **page** a visitor opens is `/share/n/{token}` — a different path on purpose. The SPA
serves the page and fetches this endpoint; if the two shared a path the app would answer its
own request with `index.html` (ADR-0071).

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
      ],
      "decisions": [
        { "id": "uuid", "name": "string", "decision_status": "accepted", "description": "markdown",
          "supersedes": [{ "id": "uuid", "title": "string" }],
          "superseded_by": [...], "governs": [...] }
      ]
    }
  ],
  "recent_activity": [...],
  "summary": {
    "total_projects": 3, "total_tasks": 25, "done_tasks": 18,
    "overdue_tasks": 1, "overall_progress": 72.0,
    "total_decisions": 4, "accepted_decisions": 3
  },
  "meta": { "generated_at": "ISO 8601", "requires_pin": false }
}
```

`decisions` carries the project's decision records with their supersession chain and the
work each governs (ADR-0120). The share assistant (ADR-0098) is fed this payload verbatim,
so a visitor can ask *why* something is built the way it is and be answered from the same
data the page shows — no separate scope decision.

`overdue_tasks` follows the one definition (ADR-0089): past due **and still open**, where
open excludes `failed` as well as `done`.

A PIN set through `/api/nodes/{id}/share/set-pin` is honoured for every type, projects
included (ADR-0072); unlock at `POST /share/node/{token}/verify`.

The owner-side share endpoints are the same six for every shareable type, and the
`/api/v1` surface mirrors them exactly: `share/rotate-token`, `share/set-pin`,
`share/pin` (DELETE), `share/set-expiry`, `share/set-guest-notes` (all `write` scope)
and `share-views` (`read`).

#### `POST /share/node/{token}/verify`
Verify the PIN for a protected share link. Sets a session cookie (15-minute TTL) and returns
the unlocked page — dispatched by node type, exactly like the `GET`.

```json
// Request
{ "pin": "1234" }

// Response 200 — full share data (same as GET above)
// Response 403 — invalid PIN
```

#### `POST /share/node/{token}/notes`
#### `POST /share/node/{token}/tasks/{tid}/notes`
Guest notes from share-page visitors (ADR-0016), when `allow_guest_notes` is on — the same
door the page is read through, so anything readable is writable (ADR-0070, ADR-0073). A share
holding one project needs no `project_id`; an identity aggregates several, so there it says
which one. Rate-limited.

```json
{ "guest_name": "string", "body": "string" }
```

---

#### `POST /share/node/{token}/chat`
Ask the public read-only assistant a question about the shared page (ADR-0098). Its entire
context is the return value of the same call that renders the page, so it can answer nothing
the visitor could not already read. Rate-limited per share token rather than per IP — the
token is the scarce resource an LLM call costs money against, and reaching this endpoint
directly rather than through the page widget is a supported use, not a bypass.

```json
// Request
{ "question": "string" }
```

Answers stream as SSE. A PIN-protected page requires the PIN session first.

---

### iCal Feeds (Public)

Read-only, unauthenticated at the middleware layer — each is gated by an unguessable token
(ADR-0021/0022/0023). Calendar clients cannot log in, hence the token.

#### `GET /ical/all/{token}.ics`
Every project (global token, rotate via `POST /settings/ical-token/rotate`).

#### `GET /ical/node/{token}.ics`
The `contains` subtree of any node whose type carries the `subscribable` role (ADR-0039) —
including an identity, which aggregates its `owns` projects. Reuses the node's
`share_token`, so a feed and its share page are revoked together. Replaced the retired
`/ical/identity/` and `/ical/project/` feeds (ADR-0071, ADR-0073).

---

### Notifications

#### `GET /notifications?unread_only=` · `GET /notifications/unread-count`
#### `PATCH /notifications/{id}/read`
#### `POST /notifications/mark-all-read`
#### `DELETE /notifications/{id}`

---

### Saved Filters

Persisted filter/view configurations for task lists.

#### `GET /saved-filters?project_id=` · `GET /saved-filters/{id}`
#### `POST /saved-filters`
```json
{ "name": "string", "project_id": "uuid | null (null = global)",
  "filters": { "status": "...", "priority": "...", "label_ids": [] } }
```
#### `PATCH /saved-filters/{id}` · `DELETE /saved-filters/{id}`

---

### Decisions

A decision record is a node of type `decision` (ADR-0118; it was a label carrying
`data.type = "decision"` until then), so it is **written** through `POST /nodes` like any
other node:

```jsonc
// POST /nodes
{ "type": "decision", "title": "string", "container_id": "<project id>",
  "data": { "decision_status": "proposed|accepted|deprecated|superseded",
            "description": "markdown", "color": "#hex" } }
```

It carries two relations of its own, and both are ordinary edges written through
`POST /nodes/{id}/edges`:

| Relation | Direction | Means |
|----------|-----------|-------|
| `supersedes` | decision → decision | this record replaces that one |
| `governs` | decision → task or container | this record decides that work |

Every decision read embeds `supersedes`, `superseded_by` and `governs` as `NodeRef` lists,
so a client never has to fetch the edges separately.

#### `GET /decisions?project_id=&status=` · `GET /decisions/{id}`
An unknown `status` is a 400, not an empty list.

#### `GET /decisions/{id}/export`
Plain-text export of the decision record, under the ADR headings. A superseded record's
`Status` line names what replaced it.

#### `POST`/`DELETE /decisions/{id}/supersedes/{superseded_id}`
Records (or withdraws) a supersession. This is the one decision write that is *not* a plain
node/edge call, because it is an edge **and** a status change on the far end: split across
two client calls, the half that can fail on its own is the one that leaves a record saying
it was replaced with nothing naming the replacement.

#### `GET /nodes/{id}/decisions`
The decisions governing a task or container — "what was decided about this?", asked from the
work's side.

---

### Goals

A goal is a container-role node (ADR-0041) — written through `POST /nodes` with
`"type": "goal"`, and it may `contains` both projects and tasks directly. Progress is
task-weighted across the whole subtree.

#### `GET /goals?status=` · `GET /goals/{id}`
Returns per-project breakdown plus subtree progress.

---

### Bulk, Import & Export

#### `POST /projects/{pid}/tasks/bulk-update`
Multi-select status/priority/assignee/pin and label add/remove in one request (500 max).
Each task runs the full mutation pipeline; one aggregate `task.bulk_updated` broadcast.

#### `POST /projects/{pid}/tasks/import`
Import a nested task tree (JSON). Subtasks recurse via `subtasks[]`.

#### `GET /projects/{pid}/tasks/export?format=json|csv`

#### `POST /projects/{pid}/import/github` · `POST /projects/{pid}/import/linear` · `POST /projects/{pid}/import/trello`
Import issues/cards from an external tool into the project.

#### `POST /projects/{pid}/tasks/reorder`
```json
{ "task_ids": ["uuid", "..."] }
```

---

### CI/CD Triggers (Outbound)

Trigger a build on an external CI/CD system.

#### `POST /cicd/trigger/github`
#### `POST /cicd/trigger/gitlab`
#### `POST /cicd/trigger/jenkins`
#### `POST /cicd/trigger/generic`

---

### Settings

#### `GET /settings`
Current non-sensitive system settings.

#### `PUT /settings/system`
Runtime-adjustable scheduler settings — persisted, no restart needed (ADR-0011).

```json
{ "backup_enabled": true, "backup_hour": 3, "backup_keep": 7 }
```

#### `GET /settings/bounds`
The accepted range for every field `PUT /settings/system` enforces. The write path reads the
same table, so a client cannot offer a value the server will silently clamp (ADR-0091).

#### `PUT /settings/llm`
The assistant's provider, model, API key and base URL, as a runtime setting rather than a
deploy secret (ADR-0096/0097). Takes effect on the next message; no restart. Saving a model
triggers a best-effort check against the provider's own list — a failure degrades to
"unverified", never to a rejected write.

#### `GET /settings/ical-token` · `POST /settings/ical-token/rotate`
#### `POST /settings/change-password`
#### `GET /settings/dashboard-widgets`
#### `GET`/`PUT /settings/preferences/{key}`

---

### Backup

Full-data backup and restore (ADR-0013/0024).

#### `GET /backup/status`
#### `POST /backup/run`
Create a server-side archive now and apply retention.

#### `GET /backup/export`
Stream a freshly built archive; nothing stored server-side.

#### `GET /backup/download/{filename}`
#### `POST /backup/restore` (multipart upload) · `POST /backup/restore/{filename}`
**Replaces all data.** Requires a `confirm` form field.

---

### Share Management (Internal API)

Share settings for **any shareable-role node** — identity, project, or a user-defined
shareable type (ADR-0039/0041). These replaced the identity-specific endpoints; the node id
is whatever you want to share.

#### `POST /nodes/{id}/share/rotate-token`
Generate a new share token. The old share URL stops working.

```json
{ "share_token": "new-uuid" }
```

#### `POST /nodes/{id}/share/set-pin`
Set a 4–6 digit PIN to protect the share link.

```json
// Request
{ "pin": "1234" }
```

#### `DELETE /nodes/{id}/share/pin`
Remove PIN protection from the share link.

#### `POST /nodes/{id}/share/set-expiry`
Set an expiration date for the share link.

```json
// Request
{ "expires_at": "ISO 8601 | null" }
```

400 if the node's type does not carry the `shareable` role.

#### `POST /nodes/{id}/share/set-guest-notes`
Allow or forbid notes from guests on the public page (ADR-0016). The guest-note gate uses
the same PIN hash as the page gate, so it cannot become a way around it (ADR-0072).

```json
{ "allow_guest_notes": true }
```

#### `GET /nodes/{id}/share-views`
Share-page access audit (ADR-0025), for any shareable-role node.

#### `GET /nodes/{id}/share-chat-log`
Questions asked of the public read-only assistant on this node's share page, newest first
(ADR-0098/0099). The assistant is given only what the page already shows, so this is a log
of what visitors asked, not of anything they could reach beyond it.

#### `POST /nodes/{id}/webhook/rotate-token`
Mint a new inbound callback address for the node. **The old callback URL stops working** —
any CI job still posting to it starts failing silently from the runner's point of view
(ADR-0084).

---

### Graph

#### `GET /graph/map?types=&include=data&limit=`
One-shot `{nodes, edges}` slice of the whole graph (ADR-0037), used by the structure map.

#### `GET /nodes?type=&query=&limit=` · `GET /nodes/{id}`
#### `GET /nodes/{id}/edges` · `GET /nodes/{id}/contained-tasks`
#### `GET /nodes/{id}/events`
Provenance: every graph event touching this node, newest first (ADR-0033).

#### `GET /nodes/{id}/subtree`
A container's child containers, each with its own rollup. The other half of its children —
the tasks — come from `contained-tasks`; the frontend never re-derives a rollup from the
tasks on screen (ADR-0065).

#### `GET /graph/ancestry?ids=a,b,c`
Where nodes live and whose they are: `contains` trails walked upward (root-first, one per
parent — a node may have several) plus `owns` owners, which are never folded into a trail
(ADR-0094). Batched because every caller is a list. Caps at `MAX_TRAILS`/`MAX_DEPTH`/
`MAX_IDS` and reports `truncated` rather than presenting a partial trail as a whole one.

#### `GET /graph-types/data-keys/managed`
The `data` keys a node type may never declare editable — feature machinery like
`share_token` and `callback_token` (ADR-0074). Served rather than mirrored in the client.

#### `GET /graph-types/nodes` · `POST /graph-types/nodes`
#### `PATCH /graph-types/nodes/{key}` · `DELETE /graph-types/nodes/{key}`
The node-type vocabulary. A type carries a `roles` set — `container`, `task`, `shareable`,
`subscribable` (ADR-0040) — and that set is what drives write dispatch. Granting a capability
is a data edit, not a schema change. Built-in types cannot be deleted.

```json
{ "key": "topic", "label": "Topic", "icon": "◆", "color": "#hex",
  "roles": ["container", "shareable"] }
```

#### `GET /graph-types/edges` · `POST /graph-types/edges`
#### `PATCH /graph-types/edges/{key}` · `DELETE /graph-types/edges/{key}`
The relationship vocabulary. `is_containment` marks relations that participate in `contains`
-style traversal; `is_symmetric` marks undirected ones.

---

### WebSocket

#### `WS /ws`
Real-time event stream. No authentication required (relies on same-origin).

Events broadcast after mutations:
- `task.created`, `task.updated`, `task.deleted`, `task.bulk_updated`, `task.imported`
- `node.created`, `node.updated`, `node.deleted` — non-task node types (project, label,
  cycle, goal, identity, custom), emitted by the role dispatcher

Message format:
```json
{ "event": "task.updated", "data": { ... } }
```

---

### Inbound Webhook

#### `POST /webhook/callback/{callback_token}`
No authentication required. `callback_token` is the task's unique webhook identifier.

Accepts either the simple format below or a native payload from GitHub Actions, GitLab CI,
Jenkins, Drone, or Bitbucket Pipelines. The provider is auto-detected from the request
headers, or can be forced with `?provider=github|gitlab|jenkins|drone|bitbucket`.

```json
// Request
{ "status": "todo | in_progress | done | failed", "message": "optional string" }

// Response 200 — the enriched task (TaskOut)
{ "id": "uuid", "status": "done", "...": "..." }

// Response 404 — token not found
{ "detail": "Invalid callback token" }

// Response 422 — ?provider= names an adapter that does not exist
{ "detail": "Unknown provider 'githbu'; expected one of [...]" }
```

**Unrecognised statuses are never guessed at** (ADR-0051). If the payload carries no
outcome this system can map — an unknown string, a provider status outside its documented
vocabulary, or no status at all — the task is **left unchanged** and the response is its
current state. Two records are written: a build-history row with `status: "unmapped"`
(visible via `GET /nodes/{id}/webhook-events`) and a `webhook.unmapped_status` activity
entry carrying the raw status that arrived.

#### `GET /nodes/{id}/webhook-events`
Build history for a node — every inbound CI/CD event received, newest first. Each row
carries `raw_payload`, the body as it arrived; for a `status: "unmapped"` row that is the
only record of what the CI system actually sent (ADR-0052).

This used to be `GET /webhook/events/{task_id}`, which sat under the credential-free
`/webhook/` prefix and was therefore readable off production by anyone holding a node id.
It was moved behind auth by ADR-0085; `/webhook/` now carries only what a runner POSTs to.

#### `POST /webhook/issues/{project_id}`
Inbound issue/PR sync from GitHub, Gitea, or GitLab (ADR-0014/0017). The provider is
auto-detected from the request headers.

---

### Health

#### `GET /health`
Liveness probe. Never authenticated.

```json
{ "status": "ok", "scheduler": { "last_tick": "ISO 8601", "ticks": 42 } }
```

---

## External API v1

Base path: `/api/v1`

**Authentication**: `X-API-Key: tdp_your_key` header

**Scopes**:
- `read` — GET endpoints
- `write` — create/update/delete nodes and edges; send email
- `admin` — all of the above + deleting a container-role node (project/goal/custom container)

A project-scoped key only accesses nodes governed by that project, and cannot create a
top-level project, goal, or identity (ADR-0042).

---

### Nodes — the write surface

#### `GET /api/v1/nodes?type=&query=&limit=`
Lists nodes visible to the key.

#### `GET /api/v1/nodes/{id}`

#### `POST /api/v1/nodes` — requires `write`
Creates a node of any registered type. `container_id` / `parent_id` file it under a
container / parent as `contains` edges. Task-role nodes return an enriched task and fire the
full reaction pipeline (activity, workflow rules, notifications, broadcast).

```json
// Request
{ "type": "task", "title": "Ship the thing", "container_id": "<project id>",
  "priority": "high", "due_date": "2026-08-01T00:00:00Z",
  "data": { "description": "markdown" } }
```

404 if `container_id`/`parent_id` does not exist, 422 for an unknown node type.

#### `PATCH /api/v1/nodes/{id}` — requires `write`
Partial update. Status changes on a task fire outbound notifications.

#### `DELETE /api/v1/nodes/{id}` — requires `write` (`admin` for containers)
Task-role nodes tear down their subtree. Container-role nodes cascade their exclusively-owned
tasks and their labels/cycles (ADR-0043); a task also linked into another container is only
unlinked.

#### `GET /api/v1/node-types` — requires `read`
Every layer with `roles`, field declarations and usage count. The `type` of a node write
must be a key from here.

#### `POST /api/v1/node-types` — requires `admin`
```json
{ "key": "organization", "label": "Organization", "roles": ["container"] }
```
`PATCH /api/v1/node-types/{key}` and `DELETE /api/v1/node-types/{key}` also require
`admin`. A built-in type refuses role changes and deletion; a type still used by nodes
refuses deletion (ADR-0079).

#### `GET /api/v1/edge-types` — requires `read`
The relation vocabulary with what may sit at each end (ADR-0078). Read-only: creating a
relation would mean declaring its endpoint rules, which is not an external contract yet.

#### `POST /api/v1/nodes/{id}/edges` — requires `write`
```json
{ "target_id": "uuid", "rel_type": "contains | owns | depends_on | labeled | in_cycle",
  "position": 0, "data": null }
```

#### `DELETE /api/v1/nodes/{id}/edges?target_id=&rel_type=` — requires `write`

#### Share facade
`POST /api/v1/nodes/{id}/share/rotate-token` · `POST /api/v1/nodes/{id}/share/set-pin` ·
`POST /api/v1/nodes/{id}/share/set-expiry` · `DELETE /api/v1/nodes/{id}/share/pin`
Available on any node whose type carries the `shareable` role.

---

### Projects

#### `GET /api/v1/projects`
Returns projects accessible to the API key.

#### `GET /api/v1/projects/{id}`
Returns project with full task list.

Project **writes** go through `/api/v1/nodes` with `"type": "project"` — see above.

---

### Tasks

#### `GET /api/v1/projects/{pid}/tasks`
Query parameters:
- `status_filter` — comma-separated statuses (e.g., `todo,in_progress`)
- `priority` — `low | medium | high`

#### `GET /api/v1/projects/{pid}/tasks/{tid}`

Single-task **writes** go through `/api/v1/nodes` — see above. The two batch endpoints below
are kept because their value is batch semantics (one request, one aggregate broadcast), not a
second write path: they call the same mutation pipeline per task.

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

### Agent Onboarding

#### `GET /api/v1/agent-context` — requires `read`
**The first endpoint an AI agent should call.** Returns platform capabilities, conventions
(including the node write surface), per-project `agent_instructions`, each project's top
active tasks, and a quick-start sequence. Global instructions come from the
`AGENT_CONTEXT_INSTRUCTIONS` environment variable.

#### `GET /api/v1/tools-schema` — requires `read`
Machine-readable tool definitions for LLM function calling / tool use.

---

### Graph (External API)

#### `GET /api/v1/graph/map?types=&include=data&limit=`
One-shot `{nodes, edges}` slice of the graph, filtered to what the key can see.

#### `GET /api/v1/nodes/{id}/edges` · `GET /api/v1/nodes/{id}/contained-tasks`
#### `GET /api/v1/nodes/{id}/events`
Provenance/audit trail for the node.

---

### Task Sub-resources (External API)

Relationships and threads on an existing task. All require `write` unless noted.

#### `GET`/`POST /api/v1/projects/{pid}/tasks/{tid}/comments`
#### `PATCH`/`DELETE /api/v1/projects/{pid}/tasks/{tid}/comments/{cid}`
#### `GET /api/v1/projects/{pid}/tasks/{tid}/dependencies`
#### `POST`/`DELETE /api/v1/projects/{pid}/tasks/{tid}/dependencies/{depends_on_id}`
#### `POST`/`DELETE /api/v1/projects/{pid}/tasks/{tid}/labels/{label_id}`
#### `GET /api/v1/projects/{pid}/labels`

#### `POST /api/v1/projects/{pid}/tasks/{tid}/progress`
Agent progress reporting — percentage, notes, and an optional comment in one call.

```json
{ "progress_pct": 60, "agent_notes": "string (optional)", "comment": "string (optional)" }
```

Send `X-Agent-Id` alongside the API key to attribute the update to a specific agent.

---

### Subscriptions & Notifications (External API)

#### `GET /api/v1/subscriptions/events`
The event vocabulary available to subscribe to.

#### `GET`/`POST /api/v1/subscriptions`
#### `PATCH`/`DELETE /api/v1/subscriptions/{id}`
Manage outbound webhook/email subscriptions programmatically.

#### `GET /api/v1/notifications` · `GET /api/v1/notifications/unread-count`
#### `PATCH /api/v1/notifications/{id}/read`
#### `POST /api/v1/notifications/mark-all-read` · `DELETE /api/v1/notifications/{id}` (`write`)
Clearing is a write. `get_notifications` could see a notification and nothing could clear
it until ADR-0093.

---

### Search & Analytics (External API)

Every analytics report takes `read`.

#### `GET /api/v1/search?q=`
#### `GET /api/v1/analytics/overview`
#### `GET /api/v1/analytics/velocity`
#### `GET /api/v1/analytics/heatmap`
#### `GET /api/v1/analytics/status-trend`

The planning half — what will happen rather than what did (ADR-0086):

#### `GET /api/v1/analytics/burndown?project_id=&days=`
#### `GET /api/v1/analytics/cycle-burndown?cycle_id=`
#### `GET /api/v1/analytics/critical-path/{project_id}`
The longest dependency chain to completion, so an agent can tell which task is actually
blocking a date rather than guessing from priority.

#### `GET /api/v1/analytics/estimate-suggestion?raw_estimate=`
#### `GET /api/v1/analytics/estimation-calibration`
How this project's estimates have historically compared to reality, and a correction
derived from it (ADR-0028).

---

### Work in and out (External API)

Intake and export. The most agent-shaped acts in the product, and the ones only a file
picker could start until ADR-0092.

#### `POST /api/v1/projects/{pid}/tasks/import` (`write`)
#### `POST /api/v1/projects/{pid}/import/trello` (`write`)
#### `POST /api/v1/projects/{pid}/import/linear` (`write`)
#### `POST /api/v1/projects/{pid}/import/github` (`write`)
The contract is **partial success**, not all-or-nothing: one malformed row does not abandon
the batch.

```json
{ "imported": 12, "skipped": 2, "errors": ["row 7: missing title"] }
```

The provider payloads are passed through as the source produced them — normalising before
sending would be a second mapping to keep in step with the importer's own.

#### `GET /api/v1/projects/{pid}/tasks/export` (`read`)
The other half of the round trip: what `tasks/import` accepts.

#### `GET /api/v1/tasks/unfiled` (`read`)
Tasks belonging to no container. The `triage-inbox` MCP prompt existed with no endpoint
behind it until ADR-0092.

#### `POST /api/v1/tasks/{task_id}/memberships/{project_id}` (`write`)
File a task into an additional container. A task may belong to several; `contains` is where
it lives, and it can live in more than one place (ADR-0032).

#### `POST /api/v1/projects/{pid}/tasks/{tid}/create-external-issue` (`write`)
Publish a task outward as a GitHub/Gitea/GitLab issue and link the two (ADR-0026). Inbound
sync was always agent-reachable; the act that *starts* the relationship was not.

---

### Attachments & Recurrence (External API)

#### `GET`/`POST /api/v1/projects/{pid}/tasks/{tid}/attachments`
#### `DELETE /api/v1/projects/{pid}/tasks/{tid}/attachments/{aid}`
#### `GET /api/v1/projects/{pid}/tasks/{tid}/attachments/{aid}/download` (`read`)
An agent's output is mostly files, and they had nowhere to go (ADR-0086). Upload takes
base64 JSON here — the SPA's multipart door and this one land in one `store`, so the 20MB
limit exists once rather than per door.

```json
{ "filename": "build.log", "content_type": "text/plain", "content_base64": "..." }
```

#### `GET`/`POST`/`PATCH`/`DELETE /api/v1/projects/{pid}/tasks/{tid}/recurrence`
`recurrence` rode on every `TaskOut` with no v1 write path until ADR-0086 — a field you can
read and never write describes a capability the API does not offer.

---

### Cycles (External API)

#### `GET /api/v1/projects/{pid}/cycles` · `GET /api/v1/projects/{pid}/cycles/{cid}` (`read`)
#### `GET /api/v1/projects/{pid}/cycles/{cid}/compare` (`read`)
#### `POST /api/v1/projects/{pid}/cycles/{cid}/duplicate` (`write`)
A cycle could be written *into* (`in_cycle` is an edge) and never read back until ADR-0086.
Duplication broadcasts and runs the mutation pipeline, which describes where the code lived,
not who may call it (ADR-0092).

---

### Decisions (External API)

#### `GET /api/v1/decisions` · `GET /api/v1/decisions/{id}` · `GET /api/v1/decisions/{id}/export` (`read`)
#### `GET /api/v1/nodes/{id}/decisions` (`read`)
The decisions governing a task or container.

#### `POST`/`DELETE /api/v1/decisions/{id}/supersedes/{superseded_id}` (`write`)
Records or withdraws a supersession — an edge plus the far end's status, as one act.

Otherwise read-only on purpose: writing a decision is `POST /api/v1/nodes` with
`type="decision"` (ADR-0118 — it used to be a label with `data.type="decision"`, and the
instruction here named a node type that did not exist), and attaching one to work is
`POST /api/v1/nodes/{decision_id}/edges` with `rel_type="governs"`. A second write path
would be the duplicate ADR-0087 exists to prevent.

---

### Automation & Integrations (External API)

Everything here was reachable only from a browser before ADR-0084/0085, which in production
means reachable only by a person holding the `AUTH_PASSWORD` — an API key cannot present one.

#### `GET`/`POST /api/v1/workflow-rules` · `GET`/`PATCH`/`DELETE /api/v1/workflow-rules/{id}`
#### `GET /api/v1/workflow-rules/vocabulary` (`read`)
#### `POST /api/v1/workflow-rules/{id}/test` (`read`)
The whole rules engine. Without it an agent could perform every write forever and never
automate one. `test` is a dry run and takes `read` because it changes nothing — it reports
what the rule *would* do, computed by the same code that would do it (ADR-0054).

#### `GET`/`POST /api/v1/integrations` · `PATCH`/`DELETE /api/v1/integrations/{id}`
#### `GET /api/v1/integrations/events` (`read`)
#### `GET /api/v1/integrations/sources` (`read`)
#### `GET /api/v1/integrations/templates` · `GET /api/v1/integrations/templates/{id}` (`read`)
#### `GET /api/v1/integrations/{id}/health` (`read`)
#### `POST /api/v1/integrations/{id}/test` (`write`)
#### `POST /api/v1/integrations/{id}/retry-all` (`write`)
Outbound targets. `/api/v1/subscriptions` is this same service with the type, name and
credentials nailed shut. Credentials are withheld on read and `null` on write means
"unchanged" (ADR-0063), so a client can GET, edit one field and PATCH back without
destroying a secret it was never shown.

#### `GET /api/v1/deliveries` · `GET /api/v1/deliveries/{id}` (`read`)
#### `POST /api/v1/deliveries/{id}/retry` (`write`) · `DELETE /api/v1/deliveries` (`admin`)
The delivery log — a webhook's failure mode is silence, so this is how an agent learns one
failed. Secret header names are derived from the integration and redacted on read as well as
write: a log is written once and read forever (ADR-0085).

#### `POST /api/v1/cicd/trigger/github` (`write`)
#### `POST /api/v1/cicd/trigger/gitlab` (`write`)
#### `POST /api/v1/cicd/trigger/jenkins` (`write`)
#### `POST /api/v1/cicd/trigger/generic` (`write`)
Start a pipeline (ADR-0085).

#### `GET /api/v1/nodes/{id}/webhook` (`admin`)
#### `POST /api/v1/nodes/{id}/webhook/rotate-token` (`admin`)
#### `POST /api/v1/nodes/{id}/webhook/rotate-secret` (`admin`)
#### `GET /api/v1/nodes/{id}/webhook-events` (`read`)
Inbound CI/CD credentials and build history. `admin` rather than `write` because the
redaction middleware would strip `callback_token` from a lesser key's response and hand back
a config with the address silently missing (ADR-0084). `webhook-events` used to sit under
the credential-free `/webhook/` prefix and was readable by anyone holding a node id
(ADR-0085).

---

### Templates (External API)

#### `GET`/`POST /api/v1/templates` · `PATCH`/`DELETE /api/v1/templates/{id}`

---

### Instance configuration (External API)

Configuring the instance was browser-only until ADR-0091. Scope follows what the response
*carries*: `read` for state, `admin` for every write and for any read that hands over a copy
of the database.

#### `GET /api/v1/settings` (`read`) · `PUT /api/v1/settings/system` (`admin`)
#### `GET /api/v1/settings/bounds` (`read`)
The accepted range for every field the write path enforces, served from the same table the
write path reads. Out-of-range is a 422 and an unknown key is refused — `{"backup_hour": 99}`
used to answer `200 {"backup_hour": 23}`, and a misspelled key used to answer `200` having
changed nothing.

#### `PUT /api/v1/settings/llm` (`admin`)
#### `GET /api/v1/settings/ical-token` · `POST /api/v1/settings/ical-token/rotate` (`admin`)
App-level rather than a node's, which is why the ADR-0070→0073 share collapse never reached
it.

#### `GET /api/v1/backup/status` (`read`)
#### `POST /api/v1/backup/run` (`admin`)
#### `GET /api/v1/backup/export` · `GET /api/v1/backup/download/{filename}` (`admin`)
#### `POST /api/v1/backup/restore` · `POST /api/v1/backup/restore/{filename}` (`admin`)
An export **is** the data, tokens and all — hence `admin` on a read. Restore replaces
everything and takes a `confirm="replace"` gate. Downloading a backup is deliberately not an
MCP tool.

---

### Graph vocabulary (External API)

#### `GET /api/v1/graph/ancestry?ids=` (`read`)
The v1 twin of the internal ancestry walk (ADR-0094).

#### `GET /api/v1/nodes/{id}/subtree` (`read`)
#### `GET /api/v1/nodes/{id}/share-views` (`read`)
#### `GET /api/v1/nodes/{id}/share-chat-log` (`read`)
#### `POST /api/v1/nodes/{id}/share/set-guest-notes` (`write`)

#### `GET /api/v1/edge-types/registry` (`read`)
#### `POST /api/v1/edge-types` · `PATCH`/`DELETE /api/v1/edge-types/{key}` (`admin`)
Edge types were read-only on v1 for a reason that did not hold: the internal door could
always create a relation with both endpoint declarations NULL, so the restriction never
prevented the bad state — only agents reaching one the UI reaches in two clicks (ADR-0086).
A relation declares what may sit at each end, and `add_edge` enforces it (ADR-0078).

---

## Events Reference

The full list is served by `GET /integrations/events` and `GET /api/v1/subscriptions/events`.
Both return the built-in `NOTIFICATION_EVENTS` from `services/notifier.py` — the only copy —
**plus every event name an active workflow rule emits via its `fire_event` action**, so a
custom event becomes subscribable as soon as something actually fires it (ADR-0048).
Subscribing to anything outside that list is rejected with 422. Every built-in event below
has a real fire site, pinned by a test (ADR-0047).

| Event | Fired when |
|---|---|
| `task.created` | New task created |
| `task.status_changed` | Task status changes (any transition) |
| `task.todo` · `task.in_progress` · `task.done` · `task.failed` | Task status changes to that value |
| `task.assigned` | Task assignee set or changed |
| `task.deleted` | Task deleted (fired before the subtree teardown) |
| `task.due_soon` | Scheduler finds a task due within `DUE_SOON_WINDOW_HOURS` |
| `task.overdue` | Scheduler finds a task past its due date, or SLA aging trips |
| `comment.created` | Comment posted (internal UI or `/api/v1`) |
| `rule.triggered` | A workflow rule matched and executed |
| `project.created` | Project node created |
| `project.complete` | All tasks in a project reach `done` |
| `project.archived` | Project status set to `archived` |

## Notification Payload

Sent to all matching active integrations — those scoped to the project, plus every
integration with `project_id: null`, which listens to all projects.

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
  "source": "user",
  "actor": "alice",
  "timestamp": "2026-03-21T10:00:00Z"
}
```

`project.created` and `project.archived` have no task to hang off, so the `task` key is
**absent** from their payload rather than filled with a placeholder — treat it as optional.

### `source` — what caused the change

Rule actions run through the same pipeline a person's change runs through, so a rule
flipping a task to `done` emits the same `task.done` a person would (ADR-0048). `source`
says which it was; `actor` names it (`"workflow"` for rules, the assignee or API key
otherwise, `null` when unattributable).

| `source` | Meaning |
|---|---|
| `user` | A person acting in the SPA (includes bulk actions and the graph API) |
| `api` | An external API key, the MCP server, or an import |
| `rule` | A workflow rule's own action |
| `scheduler` | The background loop — due dates, recurrence, digests |
| `webhook` | An inbound CI/CD callback or issue-sync echo |
| `assistant` | The LLM assistant's tools |

An integration can narrow to a subset with `sources`, served by
`GET /integrations/sources`. **Null or empty means every source**, so integrations created
before this existed are unaffected. `{"sources": ["user"]}` is how you say "tell me about
task changes, but not the ones my own automation made".

Additional headers per integration type:
- Drone: `X-Drone-Event: custom`
- Jenkins: `X-Jenkins-Source: shard`
- With secret: `Authorization: Bearer {secret}`
