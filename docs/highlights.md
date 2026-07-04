# Shard — Project Highlights

Shard is a personal multi-identity task management platform built for developers and power users. Below are the features that set it apart.

---

## 1. Bidirectional GitHub / GitLab Issue Sync

Shard bridges external issue trackers with your personal task board — issues flow in, completions flow out.

**Inbound sync (issues → tasks):**
Point your GitHub or GitLab repository's webhook at Shard, and every issue opened, edited, or closed automatically becomes a task in your project.

```
POST /webhook/issues/{project_id}
```

Setup:
1. In GitHub/GitLab, add a webhook URL: `https://your-shard.example.com/webhook/issues/<project-id>`
2. Select **Issues** events
3. Shard auto-detects the provider from request headers (`X-GitHub-Event` / `X-GitLab-Event`)
4. New issues create tasks; edits update the title/description; closed issues mark tasks as done
5. Label-based status detection: issues labeled "In Progress" or "WIP" map to `in_progress`

**Outbound sync (tasks → issues):**
When you mark a Shard task as done, the linked GitHub/GitLab issue is automatically closed via API.

Setup:
1. Create an integration of type `issue_sync` for the project
2. Store your GitHub PAT or GitLab token in the integration's `secret` field
3. When a synced task transitions to `done`, Shard calls the GitHub/GitLab API to close the issue

**Why this matters:** You get a unified view of all your work — GitHub issues, GitLab issues, and standalone tasks — in one board, with completions reflected back to the source.

### GitHub PR Linking

On the same webhook endpoint, Shard also handles `pull_request` events:

- **PR opens:** Shard parses the PR body for `Fixes #N`, `Closes #N`, `Resolves #N` references and appends a PR link to the matching task's description
- **PR merges:** All referenced tasks are automatically marked as `done`
- **No duplicate links:** If a PR link is already in the description, it won't be added again

Setup: add `Pull requests` to the same webhook you configured for Issues — Shard auto-detects the event type from headers.

---

## 2. Data Import from External Tools

Migrate your existing tasks from other tools with one API call:

| Source | Endpoint | What it imports |
|--------|----------|-----------------|
| **Trello** | `POST /projects/{id}/import/trello` | Cards with name, description, labels, due dates, closed state |
| **Linear** | `POST /projects/{id}/import/linear` | Issues with title, description, state, priority (1-4), labels, assignees |
| **GitHub Issues** | `POST /projects/{id}/import/github` | Issues with full external linking (provider, ID, URL for bidirectional sync) |

All importers auto-create labels that don't exist yet and return a summary: `{"imported": N, "skipped": N, "errors": [...]}`.

---

## 3. Critical Path Analysis

For projects with task dependencies, Shard computes the critical path — the longest chain of dependent tasks that determines the minimum project duration.

```
GET /analytics/critical-path/{project_id}
```

Returns:
- Ordered list of task IDs on the critical path
- Per-task timing: earliest start, latest start, slack (float time)
- Total project duration in minutes
- Cycle detection: gracefully reports if dependencies form a loop

Useful for identifying which tasks, if delayed, will delay the entire project.

---

## 4. SLA / Aging Alerts

The background scheduler monitors tasks for staleness:

- **3+ days stuck in `in_progress`:** Priority auto-escalated to `high` (logged as `task.sla_escalated`)
- **7+ days stuck:** `task.overdue` notification fired to all configured integrations
- **De-duplication:** Tasks already escalated in the last 7 days are not re-escalated
- Only `in_progress` tasks are affected — `todo` and `done` are ignored

No configuration needed — runs automatically every hour as part of the scheduler loop.

---

## 5. Weekly Digest Email

In addition to the daily summary, Shard sends a weekly digest on a configurable day:

- **Content:** Tasks completed this week, tasks created, overdue count, per-project progress, top 5 most active projects
- **Schedule:** Configurable via `DIGEST_DAY` env var (0=Monday through 6=Sunday, default: Monday)
- **Recipients:** All active email-type integrations (same as daily summary)

---

## 6. Multi-Identity Architecture

Unlike team-oriented tools, Shard is built for individuals who wear multiple hats. Each identity (work, side project, freelance, open source) gets its own namespace with:

- Independent project grouping and color-coded avatar
- Separate public share pages (`/s/:token`) with optional PIN protection and expiry
- Per-identity analytics and activity feeds
- iCal feed export per identity

This lets you manage your full-stack engineer job, your open-source library, and your freelance gig without context-bleeding.

---

## 7. AI Agent Integration (MCP + External API)

Shard is designed as an AI-native platform. Any LLM agent (Claude Code, OpenCode, custom agents) can manage tasks programmatically.

- **External API v1** — full REST API with API key auth, scoped permissions (`read`/`write`/`admin`), and per-project key scoping
- **MCP Server** — 20 tools available via Model Context Protocol (stdio or HTTP transport), so Claude Code or any MCP-compatible agent can query, create, and update tasks in natural conversation
- **Agent identity tracking** — `X-Agent-Id` header ties activity to specific agents in the audit log
- **Event subscriptions** — agents register callback URLs to receive webhooks on task/project events (`POST /api/v1/subscriptions`)
- **Rate limiting** — sliding window (120 req/min per key) protects against runaway agents
- **Tools schema endpoint** — `GET /api/v1/tools-schema` returns all tools in OpenAI function-calling format for self-discovery

**Built-in LLM assistant:** The web UI includes a chat interface powered by Claude, OpenAI, or a stub provider, with tool use for creating tasks, analyzing workload, and batch operations.

---

## 8. CI/CD Webhook Integration

Every task gets a unique callback URL. Point your CI/CD pipeline at it and task status updates automatically when builds pass or fail.

- **Auto-detection:** GitHub Actions, GitLab CI, Jenkins, Drone CI, and Bitbucket Pipelines are recognized from request headers — no configuration needed
- **Build history:** Each webhook event is logged with commit SHA, branch, build URL, duration, and test summary
- **Signature verification:** Supports GitHub HMAC-SHA256, GitLab token, and generic HMAC signatures
- **Replay protection:** Optional timestamp-based rejection of stale webhook deliveries
- **Outbound notifications:** When tasks complete, Shard fires webhooks (with HMAC signing) or sends emails to configured integrations
- **Retry with backoff:** Failed outbound deliveries retry at `[1, 5, 30, 120, 360]` minute intervals

---

## 9. Workflow Automation Engine

Define rules that trigger on task events and execute actions automatically:

- **Triggers:** `task.created`, `task.status_changed`, `task.priority_changed`
- **Conditions:** Filter by status, priority, labels, or assignee
- **Actions:** Auto-assign, change status, change priority, add labels, send notifications
- **Depth limiting:** Rules can trigger other rules (max depth 2) to prevent infinite loops
- **Dry run:** Test rules against existing tasks before activating

---

## 10. Customizable Dashboard

The dashboard is a command center, not just a list:

- **Widget toggle:** Show/hide any section (stats overview, command center, priority lanes, agent tasks, due soon, live signals, projects grid)
- **Server-persisted preferences:** Widget configuration survives across devices
- **Time tracking:** Inline start/stop timer on every task with elapsed time display
- **Activity ticker:** Real-time feed of recent activity across all projects

---

## 11. Multiple Project Views

Each project supports four synchronized views:

| View | Use case |
|------|----------|
| **Board** (Kanban) | Visual workflow with WIP limits per column |
| **Table** | Sortable, filterable spreadsheet view with inline editing |
| **Gantt** | Timeline visualization with date-range dependencies |
| **Calendar** | Due-date-centric monthly view |

All views share the same filter, search, and bulk-action capabilities.

---

## 12. Offline-First with Real-Time Sync

- **WebSocket live updates:** Changes broadcast instantly across all open tabs
- **Offline queue:** When disconnected, mutations are queued in IndexedDB and auto-synced on reconnect
- **Visual indicator:** Bottom-center badge shows offline status and pending mutation count

---

## 13. Full-Stack Docker Architecture

Everything runs in Docker with hot-reload — no host-level dependencies:

- **Multi-database support:** SQLite (default), PostgreSQL, or MySQL — switch with one env var
- **Production-ready:** Separate `docker-compose.prod.yml` with Nginx reverse proxy, optimized builds, and health checks
- **CI/CD pipeline:** GitHub Actions runs lint, tests, security audits, builds images, and deploys — all inside Docker
- **Alembic migrations:** Schema migrations with SQLite batch-mode compatibility

---

## 14. Developer Experience

- **Command palette** (`Ctrl+K` / `Cmd+K`): fuzzy search across tasks, projects, and navigation
- **Keyboard shortcuts:** Single-key (`c`, `n`, `/`, `?`) and chord (`g→h`, `g→a`) navigation
- **Markdown everywhere:** Task descriptions, comments, and agent notes support full GitHub-flavored markdown
- **Bulk operations:** Multi-select tasks for batch status, priority, or pin changes
- **Saved filter views:** Bookmark complex filters per project
- **JSON import/export:** Move project data in and out easily
- **Recurring tasks:** Daily, weekly, monthly, or custom-interval recurrence with auto-generation
- **Task templates:** Pre-built task structures with subtasks and labels for repeatable workflows
