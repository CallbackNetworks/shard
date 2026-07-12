# Shard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A personal multi-identity task management platform with CI/CD integration, AI agent support, and bidirectional issue sync. Built for developers who manage work across multiple roles, repositories, and tools.

## Key Highlights

- **GitHub / GitLab Issue Sync** — Bidirectional: inbound webhooks create tasks from issues, completing a task closes the external issue via API
- **GitHub PR Linking** — Parse `Fixes #N` refs in PR body, auto-close linked tasks on merge
- **AI Agent Platform** — MCP server (20 tools), External API v1, event subscriptions, agent identity tracking, and tools-schema auto-discovery
- **Multi-Identity** — Manage separate personas (work, open source, freelance) with independent projects, share pages, and analytics
- **CI/CD Webhooks** — Auto-detect GitHub Actions, GitLab CI, Jenkins, Drone, Bitbucket from headers; build history with commit/branch/duration tracking
- **Workflow Automation** — Rules engine with triggers, conditions, and actions; chain rules up to depth 2
- **Critical Path Analysis** — DAG-based computation of the longest dependency chain with slack analysis
- **SLA / Aging Alerts** — Auto-escalate tasks stuck in a status too long; fire notifications for stale work

See [**docs/highlights.md**](docs/highlights.md) for detailed descriptions of all major features.

## All Features

- **Multiple views**: Board (kanban with WIP limits), table, Gantt chart, and calendar per project
- **Time tracking**: Inline start/stop timer on tasks with elapsed time display
- **Customizable dashboard**: Toggle widget visibility with server-persisted preferences
- **LLM assistant**: Built-in AI chat with tool use (Claude, OpenAI, or stub), including batch task creation
- **Real-time sync**: WebSocket live updates + offline queue with IndexedDB
- **Cycles/sprints**: Time-box work into named cycles with progress tracking
- **Labels & decisions**: Color-coded tags and structured decision records per project
- **Comments & attachments**: Threaded markdown comments, file upload/download (max 20 MB)
- **Recurring tasks**: Daily, weekly, monthly, or custom-interval recurrence
- **Task templates**: Reusable structures with subtasks and labels
- **Analytics**: Activity heatmap, burn-down charts, velocity, status trends, and identity-level charts
- **Outbound notifications**: Webhooks (HMAC-signed) and emails with retry backoff
- **Public share pages**: Per-identity shareable pages with optional PIN protection and expiry
- **Command palette**: Fuzzy search across tasks and projects (`Ctrl+K` / `Cmd+K`)
- **Keyboard shortcuts**: Single-key and chord navigation (`?` for help)
- **Search**: Full-text search with pluggable backend
- **Bulk operations**: Multi-select tasks for batch status/priority/pin changes
- **Data import**: Trello JSON, Linear JSON, and GitHub Issues import with auto label creation
- **Weekly digest**: Scheduled email summary with per-project progress and top active projects
- **PWA support**: Installable progressive web app with offline caching and service worker
- **Saved filters & JSON import/export**: Bookmark filters, move data in/out
- **Multi-database**: SQLite (default), PostgreSQL, or MySQL
- **Optional auth**: Password-protect the UI; leave unset for local use

## Quick Start

New here? Run the interactive first-run wizard once — it checks that Docker is
installed (and tells you how to install it if not), walks you through the few
settings that matter, and can start the app for you:

```bash
scripts/setup.sh
```

Prefer to do it by hand? The wizard is optional:

```bash
# First run (or after dependency changes)
docker compose up --build

# Subsequent runs
docker compose up
```

`scripts/setup.sh --check` verifies your environment is ready without changing anything.

- Management UI: http://localhost:5173/app
- Public status page: http://localhost:5173/
- API docs (Swagger): http://localhost:8000/docs

## Routes

| Path | Description | Auth |
|------|-------------|------|
| `/` | Public status page | Public |
| `/s/:token` | Public identity share page | Public |
| `/app` | Dashboard (customizable widgets) | Protected |
| `/app/projects/:id` | Project detail (board/table/gantt/calendar) | Protected |
| `/app/identities` | Identity management | Protected |
| `/app/integrations` | Webhook/email/issue-sync config | Protected |
| `/app/api-keys` | API key management | Protected |
| `/app/analytics` | Analytics dashboard | Protected |
| `/app/workflow-rules` | Workflow automation rules | Protected |
| `/app/goals` | Goals & OKR tracking | Protected |
| `/app/activity` | Activity feed | Protected |
| `/app/settings` | System settings | Protected |
| `/login` | Password login | Public |

## Authentication

Set `AUTH_PASSWORD` in your environment to enable the login gate. Leave it empty to disable auth (default for local development).

```bash
AUTH_PASSWORD=mypassword docker compose up
```

The management UI at `/app` requires login; the public status page at `/` is always accessible.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./shard.db` | Database connection (`sqlite`, `postgresql+psycopg`, `mysql+pymysql`) |
| `AUTH_PASSWORD` | _(empty)_ | Password for management UI; empty = no auth |
| `SECRET_KEY` | _(empty)_ | Signs share-PIN session cookies. **Set in production** (`python -c "import secrets; print(secrets.token_hex(32))"`); empty = ephemeral per-process secret |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated allowed CORS origins; set to your deployed frontend origin |
| `SMTP_HOST` | _(empty)_ | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` / `SMTP_PASS` | _(empty)_ | SMTP credentials |
| `SMTP_FROM` | _(empty)_ | Sender address |
| `LLM_PROVIDER` | `stub` | LLM provider: `claude`, `openai`, or `stub` |
| `LLM_API_KEY` | _(empty)_ | API key for the chosen LLM provider |
| `LLM_MODEL` | _(varies)_ | Model name (e.g. `claude-sonnet-4-6`, `gpt-4o`) |
| `MCP_TRANSPORT` | `stdio` | MCP server transport: `stdio` or `http` |
| `MCP_API_KEY` | _(empty)_ | API key for MCP server to call backend |
| `SUMMARY_HOUR` | `8` | Hour (UTC) to send daily summary email |

Copy `.env.example` to `.env` in the project root and adjust:

```env
AUTH_PASSWORD=your_password
SECRET_KEY=change_me_to_a_random_64_char_hex
CORS_ORIGINS=https://your-frontend.example.com
SMTP_HOST=smtp.example.com
SMTP_FROM=notify@example.com
SMTP_USER=notify@example.com
SMTP_PASS=smtp_password

# LLM assistant (optional)
LLM_PROVIDER=claude
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

## Dependency Changes

After editing `backend/requirements.txt` or `frontend/package.json`:

```bash
docker compose build
docker compose up
```

For frontend package additions, also remove the cached node_modules volume:

```bash
docker compose down
docker volume rm $(basename $PWD)_frontend_modules
docker compose up --build
```

## Documentation

- [**Visual Tour**](docs/screenshots.md) — annotated screenshots of the main features
- [**Highlights**](docs/highlights.md) — detailed feature descriptions and usage
- [Architecture](docs/architecture.md) — system design, data models, data flow
- [API Reference](docs/api.md) — all endpoints, request/response schemas
- [Agent Guide](docs/agent-guide.md) — AI agent integration (API, MCP, subscriptions)
- [Deployment](docs/deployment.md) — VPS/production setup guide
- [Integrations](docs/integrations.md) — CI/CD webhook setup
- [ADRs](docs/adr/) — architecture decision records

## Contributing

Contributions are welcome. See [CONTRIBUTING](.github/CONTRIBUTING.md) for the
development setup and quality bar, and the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
Before deploying beyond localhost, read the hardening notes in
[SECURITY](.github/SECURITY.md).

## License

Released under the [MIT License](LICENSE).
