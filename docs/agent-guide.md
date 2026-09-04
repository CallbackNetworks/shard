# Agent Integration Guide

This document describes how external AI agents (Claude Code, OpenCode, Hermes, etc.) can interact with the Shard task management platform.

## Access Methods

| Method | Transport | Best For |
|--------|-----------|----------|
| MCP Server (stdio) | Local process pipe | Claude Code, OpenCode running on same host |
| MCP Server (HTTP) | Remote HTTP + SSE | Remote agents, cloud-hosted AI |
| External API v1 | REST + JSON | Hermes, custom agents, any HTTP client |

## Authentication

### MCP (stdio)

No authentication needed — the client owns the process, and it authenticates to the backend using its own API key (`MCP_API_KEY` env var).

### MCP (HTTP)

Remote MCP is a route on the backend, reached through the frontend's nginx (ADR-0080) — there is no separate service and no separate port. Set `MCP_HTTP_TOKEN` on the deployment; that variable is also the switch, since without it the route is not registered at all and `/mcp` answers 404.

Clients connect to `https://<host>/mcp` with:

```
Authorization: Bearer <MCP_HTTP_TOKEN>
```

### External API v1

All requests require an `X-API-Key` header:

```
X-API-Key: tdp_<your_key>
```

API keys have scopes: `read`, `write`, `admin`. Create keys via the web UI (Settings > API Keys).

### Agent Identity (optional)

Include an `X-Agent-Id` header to identify your agent instance in activity logs:

```
X-Agent-Id: claude-code-session-abc123
```

This makes it easy to trace which agent performed which actions. The value is free-form — use something like `<agent-type>-<session-id>`.

## Rate Limits

The External API enforces a sliding window of **120 requests per minute** per API key. If exceeded, the API returns `429 Too Many Requests` with a `Retry-After: 60` header.

## Quick Start

Every agent session should begin with:

```
1. GET /api/v1/agent-context     → platform capabilities, conventions, active projects
2. GET /api/v1/summary           → current state across all projects
3. Start working on tasks
```

## The write surface: everything is a node

Every first-class entity — task, project, label, cycle, goal, identity, and any
user-defined type — is a **node**, and relationships between them are **edges**. So there is
exactly one way to create, update, or delete anything:

| Operation | Endpoint |
|---|---|
| Create | `POST /api/v1/nodes` |
| Update | `PATCH /api/v1/nodes/{node_id}` |
| Delete | `DELETE /api/v1/nodes/{node_id}` |
| Link / unlink | `POST` / `DELETE /api/v1/nodes/{node_id}/edges` |

The old per-entity write routes (`POST /api/v1/projects`, `POST /api/v1/projects/{pid}/tasks`,
`PATCH /api/v1/projects/{pid}/tasks/{tid}`, …) were retired and now return **405**. What
remains under `/api/v1/projects/...` is reads, relationship sub-resources (labels,
dependencies, comments), and operations (progress, bulk).

Scopes still apply, and containers are treated as higher-risk: a project-scoped API key
cannot create a top-level project, goal, or identity, and deleting a container-role node
requires the `admin` scope because it cascades.

## Task Lifecycle

```
todo → in_progress → done
                  → failed
```

### Status Meanings

| Status | Meaning |
|--------|---------|
| `todo` | Not started, waiting to be picked up |
| `in_progress` | Actively being worked on |
| `done` | Completed successfully |
| `failed` | Could not be completed |

### Priority Levels

| Priority | When to use |
|----------|-------------|
| `high` | Blocking other work, time-sensitive, critical path |
| `medium` | Normal work, should be done this cycle |
| `low` | Nice to have, can wait |

## Common Operations

### List projects

```
GET /api/v1/projects
```

### Get project with all tasks

```
GET /api/v1/projects/{project_id}
```

### Create a task

`container_id` is the project (or any container-role node) the task belongs to; omit it and
the task lands in the unfiled inbox. Use `parent_id` instead to create a subtask.

```
POST /api/v1/nodes
Content-Type: application/json

{
  "type": "task",
  "title": "Implement user authentication",
  "container_id": "{project_id}",
  "priority": "high",
  "description": "Add JWT-based auth flow",
  "assignee": "agent:claude-code",
  "due_date": "2026-07-10"
}
```

### Update task status

```
PATCH /api/v1/nodes/{task_id}
Content-Type: application/json

{"status": "in_progress"}
```

### Create a project

```
POST /api/v1/nodes
Content-Type: application/json

{"type": "project", "title": "Billing rewrite", "description": "Q3 migration"}
```

Requires an unscoped key — a project-scoped key cannot create top-level containers.

### Delete a node

```
DELETE /api/v1/nodes/{node_id}
```

Deleting a task tears down its subtree. Deleting a container cascades its exclusively-owned
tasks and its scoped labels and cycles, so it requires the `admin` scope. Tasks that also
belong to another container are unlinked rather than deleted.

### Report progress

```
POST /api/v1/projects/{project_id}/tasks/{task_id}/progress
Content-Type: application/json

{
  "progress_pct": 60,
  "agent_notes": "Completed API routes, working on tests",
  "comment": "Added 3 endpoints, 2 remaining"
}
```

### Bulk create / update tasks

Bulk endpoints are kept alongside the node surface because they are batch operations, not a
second single-entity write path. Each item still runs the full mutation pipeline.

```
POST /api/v1/projects/{project_id}/tasks/bulk
Content-Type: application/json

[
  {"title": "Write migration"},
  {"title": "Backfill rows", "priority": "high"}
]
```

```
POST /api/v1/projects/{project_id}/tasks/bulk-update
Content-Type: application/json

[
  {"id": "task-1", "status": "done"},
  {"id": "task-2", "priority": "high"}
]
```

### Search

```
GET /api/v1/search?q=authentication&limit=10
```

### Add a comment

```
POST /api/v1/projects/{project_id}/tasks/{task_id}/comments
Content-Type: application/json

{
  "body": "Found the root cause — null check missing in auth middleware",
  "author": "agent:claude-code"
}
```

### Manage dependencies

```
POST /api/v1/projects/{project_id}/tasks/{task_id}/dependencies/{depends_on_id}
```

### Link nodes directly

Anything the named sub-resources do not cover is an edge. `rel_type` is one of `contains`,
`owns`, `depends_on`, `labeled`, `in_cycle`, or any type registered in the edge-type
vocabulary — read it, with the node types allowed at each end, from
`GET /api/v1/edge-types`. Those endpoint rules are enforced: an edge whose endpoints do
not satisfy the declaration is refused with a 400 naming the relation you probably meant
(ADR-0078). The two that get confused: `contains` says *where a node lives* and drives
every rollup, `owns` says *which identity it belongs to*. A node may have any number of
parents — `container_id` on create is just the first one.

```
POST /api/v1/nodes/{node_id}/edges
Content-Type: application/json

{"target_id": "{other_node_id}", "rel_type": "contains"}
```

Use `DELETE /api/v1/nodes/{node_id}/edges?target_id=...&rel_type=...` to unlink.

### Layers (node types)

The `type` of every node write must be a key from the node-type registry. Read it rather
than guessing — a custom layer is not discoverable any other way:

```
GET /api/v1/node-types      # key, label, roles, field declarations, usage count
```

`roles` is what decides where a node of that type may sit: `container` may parent other
nodes through `contains`, `task` may be a subtask. To add a layer of your own — say an
`organization` above projects — register the type (needs an `admin` key, ADR-0079):

```
POST /api/v1/node-types
Content-Type: application/json

{"key": "organization", "label": "Organization", "roles": ["container"]}
```

Then it is an ordinary node: `POST /api/v1/nodes {"type": "organization", "title": "..."}`,
and `contains` edges file projects under it. Both vocabularies also arrive together in
`GET /api/v1/agent-context` under `conventions.node_types` and `conventions.relations`.

### Explore the graph

```
GET /api/v1/nodes?type=task&query=auth&limit=50
GET /api/v1/nodes/{node_id}/edges
GET /api/v1/nodes/{node_id}/contained-tasks
GET /api/v1/graph/map?types=project,task&include=data&limit=500
```

## Recurring work, and giving it to another agent

Shard holds the *schedule*; it does not run the agent. That split is deliberate — see
[ADR-0149](adr/0149-recurring-work-is-scheduled-here-and-run-there.md) — and it answers the
question most people ask first, which is whether the workflow rules engine can do this.
**It cannot**: all five of its triggers (`node.created`, `node.updated`, `node.deleted`,
`edge.added`, `edge.removed`) require that something already changed. Nothing fires because
time passed, so no rule can say "every Monday".

What does repeat on a timer is a **task**. Make one recurring and the scheduler generates a
fresh copy each time the rule comes round.

### Make a task repeat

```
POST /api/v1/projects/{project_id}/tasks/{task_id}/recurrence
Content-Type: application/json

{
  "frequency": "weekly",
  "day_of_week": 1,
  "next_run_at": "2026-09-08T09:00:00Z"
}
```

`frequency` is `daily`, `weekly`, `monthly` or `interval`. `day_of_week` is 0=Mon..6=Sun
(weekly only), `day_of_month` is 1..31 (monthly only), and `interval_value` is "every N
days" for `interval`. `end_date` stops it; `next_run_at` is required and sets the first run.

`GET` reads it, `PATCH` changes it (`{"active": false}` pauses without losing the rule),
`DELETE` removes it. One rule per task — a second `POST` is a 409. Over MCP this is the
single `manage_recurrence(action, project_id, task_id, config)` tool.

### Address it to a specific agent

Set `assigned_agent_key_id` on the **template** task. It names an API key — an agent — and
is validated against a live one, unlike the free-text `assignee` field, which is for people.

```
PATCH /api/v1/nodes/{template_task_id}
{ "assigned_agent_key_id": "<the other agent's api key id>" }
```

Every generated copy carries that assignment forward. So work is addressed to one agent at
the moment it is created, and **there are no unowned tasks to race over** — you do not need
to claim or lock anything. A key that has been revoked in the meantime is dropped rather
than copied forward, and the generated task arrives unassigned.

The copy carries title, description, priority, assignee and the agent key. It does **not**
carry labels, due date or estimate.

### Find out it happened

Shard will not call your agent — it has no way to start one. Subscribe to `task.created`
and start the agent yourself when the webhook arrives:

```
POST /api/v1/subscriptions
Content-Type: application/json

{
  "name": "wake-agent-b",
  "callback_url": "https://your-runner/hook",
  "events": ["task.created"],
  "secret": "<shared secret, so you can verify X-Signature>"
}
```

Add `"project_id"` to scope the subscription to one project.

A task the scheduler generated carries `source: "scheduler"` in the payload, which is how
you tell scheduled work apart from a task somebody just typed. Deliveries are HMAC-signed
(`X-Signature`), logged, and retried on failure at 1, 5, 30, 120 and 360 minutes.

**A retry can wake the same agent twice for the same task.** If your work has a side effect
that must not happen twice (sending mail, opening a PR), make that action idempotent on your
side — Shard has no claim or lease mechanism, and would not help here if it did, since both
sessions hold the same key.

Then have the agent ask what is waiting for it. **There is no server-side filter on
`assigned_agent_key_id`** — list and check the field yourself, which is on every `TaskOut`:

```
GET /api/v1/projects/{project_id}/tasks?status_filter=todo
```

The webhook payload names the task directly, so the usual flow is to read that rather than
poll. Polling is the fallback for a runner that missed a delivery.

### What this is not for

A check that usually finds nothing wrong should not generate a task — an hourly "is CI red?"
leaves 24 cards a day behind. There is currently no timer that fires an event without
creating a task; if you need one, say so, because that is the observation that would reopen
ADR-0149.

## Tool Schema Discovery

For HTTP-based agents that need tool definitions in function-calling format:

```
GET /api/v1/tools-schema
```

Returns an array of tool definitions compatible with OpenAI function-calling format:

```json
[
  {
    "name": "create_task",
    "description": "Create a new task in a project",
    "parameters": {
      "type": "object",
      "properties": { ... },
      "required": ["project_id", "title"]
    }
  }
]
```

## Conventions

### Task titles

- Use imperative form: "Add login page", not "Adding login page" or "Login page"
- Be specific: "Fix null pointer in auth middleware" not "Fix bug"
- Max 500 characters

### Progress reporting

- Call `report_progress` at meaningful milestones, not on every minor step
- Set `progress_pct` to reflect actual completion (0-100)
- Use `agent_notes` for machine-readable status; use `comment` for human-readable updates

### Avoiding duplicates

Before creating a task, search for existing tasks with similar titles:

```
GET /api/v1/search?q=<keywords>
```

### Labels

Labels help categorize tasks. List available labels per project:

```
GET /api/v1/projects/{project_id}/labels
```

### Workflow rules

The platform has automated workflow rules (e.g., "when all subtasks are done, mark parent as
done") — a status you write may be changed again by a rule immediately afterwards, so re-read
the task if the exact final state matters. They are reachable at `/api/v1/workflow-rules`
(ADR-0085), so you can read what is configured rather than guess. Their triggers are all
reactive; for work that repeats on a clock see **Recurring work** above.

## Agent Configuration

### Claude Code

Add to your MCP settings (e.g., `~/.claude/mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "shard": {
      "command": "docker",
      "args": [
        "compose", "-f", "/path/to/project/docker-compose.yml",
        "run", "--rm", "--no-deps", "-T",
        "backend", "python", "-m", "app.mcp_server.server"
      ],
      "env": {
        "API_BASE_URL": "http://backend:8000",
        "API_KEY": "your-mcp-api-key"
      }
    }
  }
}
```

Or for remote HTTP MCP:

```json
{
  "mcpServers": {
    "shard": {
      "url": "https://your-server/mcp",
      "headers": {
        "Authorization": "Bearer your-mcp-http-token"
      }
    }
  }
}
```

### OpenCode

Create `.opencode.yaml` in your project root:

```yaml
mcpServers:
  shard:
    type: http
    url: https://your-server/mcp
    headers:
      Authorization: "Bearer your-mcp-http-token"
```

Or for stdio transport:

```yaml
mcpServers:
  shard:
    type: stdio
    command: docker
    args:
      - compose
      - -f
      - /path/to/project/docker-compose.yml
      - run
      - --rm
      - --no-deps
      - -T
      - backend
      - python
      - -m
      - app.mcp_server.server
    env:
      API_BASE_URL: http://backend:8000
      API_KEY: your-mcp-api-key
```

### Hermes / HTTP-based agents

1. Fetch tool definitions:
   ```
   GET /api/v1/tools-schema
   ```

2. Use the returned schema array as your function definitions.

3. Execute tools by calling the corresponding REST endpoints with `X-API-Key` auth.

4. On session start, fetch context:
   ```
   GET /api/v1/agent-context
   ```

## MCP Tools Reference

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `get_summary` | Platform overview: project stats, active/overdue tasks |
| `get_agent_context` | Onboarding: capabilities, conventions, instructions |
| `list_projects` | List all projects (optional status filter) |
| `get_project_detail` | Full project with all tasks in one call |
| `list_tasks` | List tasks for a project (optional status/priority filter) |
| `create_task` | Create a new task |
| `update_task` | Update task fields |
| `delete_task` | Permanently delete a task |
| `create_subtask` | Create a subtask under an existing task |
| `bulk_update_tasks` | Batch update multiple tasks at once |
| `create_project` | Create a new project |
| `manage_labels` | List/add/remove labels on tasks |
| `manage_dependencies` | List/add/remove task dependencies |
| `add_comment` | Add a comment to a task |
| `list_comments` | List all comments on a task |
| `search` | Full-text search across tasks and projects |
| `get_activity` | Recent activity log |
| `get_notifications` | In-app notifications |
| `report_progress` | Report intermediate progress on a task |
| `analyze_workload` | Workload analytics (per-project or platform-wide) |

## Safety Guidelines

- **Do not delete containers** (projects, goals, or any container-role node) without explicit
  user confirmation — the delete cascades to their tasks, labels, and cycles
- **Do not bulk-reassign** tasks without checking current assignees
- **Do not change workflow rules** — these are user-configured automation
- **Report progress** regularly so the user can track your work
- **Add comments** to explain non-obvious decisions
- **Check dependencies** before marking a task as done — blocked tasks should not be completed

## Best Practices

- Batch operations where possible (use bulk endpoints)
- Avoid polling in tight loops (use webhooks or check periodically)
- Cache `agent-context` for the session duration (it rarely changes)
