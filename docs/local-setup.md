# Local Development Setup

## Prerequisites

- Docker and Docker Compose v2+
- Git

No host-level Python or Node.js installation is needed. All dependencies run inside Docker containers.

## Quick Start

```bash
git clone <repo-url> && cd 20260318
cp .env.example .env   # edit as needed
docker compose up --build
```

- Frontend: http://localhost:5173/
- Backend API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

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

## Environment Variables

All configuration lives in `.env` (gitignored). See `CLAUDE.md` for the full variable reference.

Key variables for local development:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_PASSWORD` | _(empty)_ | Set to enable login; leave empty for no auth |
| `LLM_PROVIDER` | `stub` | Use `stub` locally to avoid API costs |

## Day-to-Day Development

```bash
docker compose up        # start with hot-reload
docker compose logs -f backend   # tail backend logs
docker compose logs -f frontend  # tail frontend logs
```

Both backend (FastAPI) and frontend (Vite) support hot-reload. Code changes are reflected immediately without restarting containers.

## Running Tests

```bash
# Backend (pytest, 400+ tests)
docker compose exec backend python -m pytest -q

# Frontend (vitest, 50+ tests)
docker compose exec frontend npx vitest run
```

## Dependency Changes

### Python (backend)

1. Edit `backend/requirements.txt`
2. Rebuild:

```bash
docker compose build backend && docker compose up
```

### JavaScript (frontend)

1. Edit `frontend/package.json`
2. Remove the cached volume and rebuild:

```bash
docker compose down
docker volume rm 20260318_frontend_modules
docker compose up --build
```

## Adding a New Backend Router

1. Create `backend/app/routers/your_feature.py` with an `APIRouter`
2. Register it in `backend/app/main.py`:
   ```python
   from app.routers import your_feature
   app.include_router(your_feature.router)
   ```
3. If the router serves a path that the frontend needs to proxy, add the prefix to **both** places in `frontend/vite.config.js`:
   - `server.proxy` object
   - `isProxied` array in the SPA fallback middleware
4. If the route should bypass auth, add it to `_AUTH_BYPASS` in `main.py`

## Adding a Schema Migration

Use Alembic (not inline `ALTER TABLE`):

```bash
# Generate migration from model changes
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'add foo column'"

# Apply migration
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

Alembic is configured with `render_as_batch=True` for SQLite compatibility.

## Project Structure

```
backend/
  app/
    main.py              # FastAPI app, middleware, lifespan
    models.py            # SQLAlchemy ORM models
    schemas.py           # Pydantic request/response types
    database.py          # DB session setup
    routers/             # API endpoint modules
    services/            # Business logic (notifier, scheduler, etc.)
  tests/                 # pytest test suites
  migrations/            # Alembic migration scripts

frontend/
  src/
    App.jsx              # Root component, routing, layout
    api/client.js        # Axios API layer
    pages/               # Route-level page components
    components/          # Shared UI components
    constants/theme.js   # Design tokens
    context/             # React contexts (Auth, Toast)
    hooks/               # Custom hooks (useRealtimeSync)
    styles/global.css    # Global CSS and utility classes
```
