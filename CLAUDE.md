# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

All services run in Docker. **Never install Python packages or Node modules on the host.**

```bash
docker compose up --build   # first run or after changing dependencies
docker compose up           # subsequent runs
```

- Backend API: http://localhost:8000 (FastAPI auto-docs at `/docs`)
- Frontend UI: http://localhost:5173

Both services hot-reload when source files change on the host.

## Dependency changes

```bash
# After editing backend/requirements.txt or frontend/package.json:
docker compose build
docker compose up
```

## Architecture

**Backend** (`backend/app/`): FastAPI + SQLAlchemy (SQLite)

- `main.py` — app entry, CORS, lifespan (creates DB tables on startup)
- `models.py` — three ORM models: `Project`, `Task`, `Integration`
- `schemas.py` — Pydantic schemas for all request/response types
- `routers/projects.py` — CRUD; progress (`done/total * 100`) is computed on read, not stored
- `routers/tasks.py` — CRUD; each task gets a unique `callback_token` (UUID) on creation
- `routers/webhooks.py` — `POST /webhook/callback/{token}` — the inbound CI/CD endpoint; updates task status then calls `notifier.fire_notifications()`
- `routers/integrations.py` — CRUD for outbound notification targets + test endpoint
- `services/notifier.py` — async httpx POSTs to configured integrations; adds CI/CD-specific headers (`X-Drone-Event` for Drone, `X-Jenkins-Source` for Jenkins); also fires `project.complete` when all tasks reach `done`

**Frontend** (`frontend/src/`): React + Vite + React Query + React Router

- Vite proxies `/projects`, `/webhook`, `/integrations`, `/health` to the backend. In Docker the target is `http://backend:8000` (set via `BACKEND_URL` env var); locally it falls back to `http://localhost:8000`
- All API calls are in `api/client.js` (axios wrappers)
- Three pages: `Dashboard` (project grid), `ProjectDetail` (tasks grouped by status, copyable webhook URLs per task), `Integrations` (CI/CD notification config)

## Key data flow: CI/CD callback

```
CI/CD pipeline
  POST /webhook/callback/{task.callback_token}
  body: { "status": "done|in_progress|failed", "message": "..." }
    → task status updated
    → notifier fires outbound POST to all matching active integrations
    → if all tasks done → fires "project.complete" event too
```

## Integration notification payload

```json
{
  "event": "task.done",
  "project": { "id", "name", "progress", "total_tasks", "done_tasks" },
  "task": { "id", "title", "status", "priority" },
  "timestamp": "ISO8601"
}
```

`Authorization: Bearer {secret}` is added when a secret is set. Drone also gets `X-Drone-Event: custom`.

## Database

SQLite file lives at `/app/data/todo_platform.db` inside the backend container, persisted via the `backend_data` named volume. Tables are created automatically on startup via `Base.metadata.create_all()`.
