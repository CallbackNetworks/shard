# Shard

A personal multi-identity task manager with CI/CD webhook integration. Manage tasks across multiple identities (work, side projects, roles), automate status updates via CI/CD pipeline callbacks, and share public status pages per identity.

## Features

- **Multi-identity**: Group projects under separate identities (personas/roles), each with a color and avatar
- **CI/CD webhooks**: Inbound callbacks from Drone CI / Jenkins / GitHub Actions update task status automatically
- **Outbound notifications**: Fire webhooks or emails when tasks complete or projects finish
- **External API**: REST API v1 with API key auth for scripts and AI agents
- **Markdown editor**: Ghost-style inline WYSIWYG editing with raw markdown toggle
- **Multiple views**: Board (kanban), table, and Gantt chart per project
- **Cycles/sprints**: Time-box work into named cycles
- **Labels**: Color-coded tags per project
- **Comments**: Threaded comments on tasks with markdown support
- **Attachments**: File upload/download on tasks (max 20 MB)
- **Recurring tasks**: Daily, weekly, monthly, or interval-based task recurrence
- **Task templates**: Reusable templates with predefined subtasks and labels
- **Workflow rules**: Automation rules triggered on task create/update (auto-assign, set status, etc.)
- **Analytics**: Overview, activity heatmap, burn-down charts, velocity, and status trends
- **LLM assistant**: Built-in AI chat with tool use (supports Claude, OpenAI, or stub mode)
- **Real-time sync**: WebSocket-based live updates across tabs
- **Public share pages**: Per-identity shareable pages with optional PIN protection and expiry
- **Search**: Full-text search across tasks and projects (⌘K / Ctrl+K command palette)
- **Optional auth**: Password-protect the management UI; leave unset for local/dev use

## Quick Start

```bash
# First run (or after dependency changes)
docker compose up --build

# Subsequent runs
docker compose up
```

- Management UI: http://localhost:5173/app
- Public status page: http://localhost:5173/
- API docs (Swagger): http://localhost:8000/docs

## Routes

| Path | Description | Auth |
|------|-------------|------|
| `/` | Public status page | Public |
| `/s/:token` | Public identity share page | Public |
| `/app` | Dashboard (My Issues) | Protected |
| `/app/projects/:id` | Project detail | Protected |
| `/app/identities` | Identity management | Protected |
| `/app/integrations` | Webhook/email config | Protected |
| `/app/api-keys` | API key management | Protected |
| `/app/analytics` | Analytics dashboard | Protected |
| `/app/workflow-rules` | Workflow automation rules | Protected |
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
| `AUTH_PASSWORD` | _(empty)_ | Password for management UI; empty = no auth |
| `SMTP_HOST` | _(empty)_ | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | _(empty)_ | SMTP username |
| `SMTP_PASS` | _(empty)_ | SMTP password |
| `SMTP_FROM` | _(empty)_ | Sender address |
| `SMTP_USE_TLS` | `true` | Enable STARTTLS |
| `LLM_PROVIDER` | `stub` | LLM provider: `claude`, `openai`, or `stub` |
| `LLM_API_KEY` | _(empty)_ | API key for the chosen LLM provider |
| `LLM_MODEL` | _(varies)_ | Model name (e.g. `claude-sonnet-4-6`, `gpt-4o`) |
| `SUMMARY_HOUR` | `8` | Hour (UTC) to send daily summary email |

Create a `.env` file in the project root:

```env
AUTH_PASSWORD=your_password
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

- [Architecture](docs/architecture.md) — system design, data models, data flow
- [API Reference](docs/api.md) — all endpoints, request/response schemas
- [Deployment](docs/deployment.md) — VPS/production setup guide
- [Integrations](docs/integrations.md) — CI/CD webhook setup for Drone and Jenkins
