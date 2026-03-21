# TODO Platform

A personal multi-identity task manager with CI/CD webhook integration. Manage tasks across multiple identities (work, side projects, roles), automate status updates via CI/CD pipeline callbacks, and share public status pages per identity.

## Features

- **Multi-identity**: Group projects under separate identities (personas/roles), each with a color and avatar
- **CI/CD webhooks**: Inbound callbacks from Drone CI / Jenkins update task status automatically
- **Outbound notifications**: Fire webhooks or emails when tasks complete or projects finish
- **External API**: REST API v1 with API key auth for scripts and AI agents
- **Markdown editor**: Ghost-style inline WYSIWYG editing with raw markdown toggle
- **Multiple views**: Board (kanban), table, and Gantt chart per project
- **Cycles/sprints**: Time-box work into named cycles
- **Labels**: Color-coded tags per project
- **Public status page**: Shareable `/` overview, optionally scoped to an identity via `?identity={id}`
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
| `/app` | Dashboard (My Issues) | Protected |
| `/app/projects/:id` | Project detail | Protected |
| `/app/identities` | Identity management | Protected |
| `/app/integrations` | Webhook/email config | Protected |
| `/app/api-keys` | API key management | Protected |
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

Create a `.env` file in the project root:

```env
AUTH_PASSWORD=your_password
SMTP_HOST=smtp.example.com
SMTP_FROM=notify@example.com
SMTP_USER=notify@example.com
SMTP_PASS=smtp_password
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
