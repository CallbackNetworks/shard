import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import engine
from app.models import Base
from app.routers import projects, tasks, webhooks, integrations, labels, cycles, api_keys, external_api, activity, identities, share
from app.routers import comments, search, recurring, webhook_logs, analytics, workflow_rules, assistant, templates, attachments
from app.routers import ws as ws_router
from app.routers.labels import task_label_router
from app.routers.auth import router as auth_router, verify_token
from app.services.scheduler import due_date_reminder_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Migrate: add columns if they don't exist yet
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        task_cols = {c["name"] for c in inspect(engine).get_columns("tasks")}
        for col in ("start_date", "due_date"):
            if col not in task_cols:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} DATETIME"))
        if "parent_id" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN parent_id VARCHAR(36) REFERENCES tasks(id)"))
        if "assignee" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN assignee VARCHAR(255)"))
        # Migrate integration email fields
        intg_cols = {c["name"] for c in inspect(engine).get_columns("integrations")}
        if "email_to" not in intg_cols:
            conn.execute(text("ALTER TABLE integrations ADD COLUMN email_to TEXT"))
        if "email_subject_prefix" not in intg_cols:
            conn.execute(text("ALTER TABLE integrations ADD COLUMN email_subject_prefix VARCHAR(255) DEFAULT '[TODO Platform]'"))
        # Migrate identity share_token
        import uuid as _uuid
        identity_cols = {c["name"] for c in inspect(engine).get_columns("identities")}
        if "share_token" not in identity_cols:
            conn.execute(text("ALTER TABLE identities ADD COLUMN share_token VARCHAR(36)"))
            rows = conn.execute(text("SELECT id FROM identities")).fetchall()
            for (row_id,) in rows:
                conn.execute(text("UPDATE identities SET share_token = :t WHERE id = :id"),
                             {"t": str(_uuid.uuid4()), "id": row_id})
        # Migrate identity share PIN and expiry
        if "share_pin_hash" not in identity_cols:
            conn.execute(text("ALTER TABLE identities ADD COLUMN share_pin_hash VARCHAR(128)"))
        if "share_expires_at" not in identity_cols:
            conn.execute(text("ALTER TABLE identities ADD COLUMN share_expires_at DATETIME"))
        # Migrate task reminder_sent_at
        if "reminder_sent_at" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN reminder_sent_at DATETIME"))
        # Migrate time tracking fields
        if "time_estimate" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN time_estimate INTEGER"))
        if "time_spent" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN time_spent INTEGER"))
        if "position" not in task_cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN position INTEGER DEFAULT 0 NOT NULL"))
        conn.commit()

    # Start background scheduler for due date reminders
    _scheduler_task = asyncio.create_task(due_date_reminder_loop())
    yield
    _scheduler_task.cancel()


API_DESCRIPTION = """
Personal multi-identity task management platform with CI/CD webhook integration.

## Authentication

The External API (v1) requires an API key passed via the `X-API-Key` header.
Create keys in the web UI under **API Keys**. Keys start with `tdp_`.

## Scopes

| Scope | Access |
|-------|--------|
| `read` | GET endpoints — list/view projects, tasks, stats, summary, activity |
| `write` | POST/PATCH/DELETE — create/update/delete projects and tasks, send emails |
| `admin` | All operations including destructive actions (delete projects) |

Keys can optionally be scoped to a single project via `project_id`.

## For AI Agents

Start with `GET /api/v1/summary` to get a full snapshot of all work, grouped by identity and project.
Use `GET /api/v1/activity` to see what changed recently.
"""

tags_metadata = [
    {
        "name": "External API v1",
        "description": "Authenticated API for external services, scripts, and AI agents. Requires `X-API-Key` header.",
    },
    {
        "name": "projects",
        "description": "Internal project CRUD (used by the web UI).",
    },
    {
        "name": "tasks",
        "description": "Internal task CRUD (used by the web UI).",
    },
    {
        "name": "webhooks",
        "description": "Inbound CI/CD webhook callbacks.",
    },
]

_AUTH_BYPASS = (
    "/auth/",
    "/health",
    "/webhook/",
    "/share/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/ws",
)

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not os.environ.get("AUTH_PASSWORD", ""):
            return await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in _AUTH_BYPASS):
            return await call_next(request)
        auth_header = request.headers.get("authorization", "")
        token = auth_header.removeprefix("Bearer ").strip()
        if not verify_token(token):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)


app = FastAPI(
    title="TODO Platform",
    version="1.0.0",
    description=API_DESCRIPTION,
    openapi_tags=tags_metadata,
    lifespan=lifespan,
)

app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(webhooks.router)
app.include_router(integrations.router)
app.include_router(labels.router)
app.include_router(task_label_router)
app.include_router(cycles.router)
app.include_router(api_keys.router)
app.include_router(external_api.router)
app.include_router(activity.router)
app.include_router(identities.router)
app.include_router(share.router)
app.include_router(comments.router)
app.include_router(search.router)
app.include_router(recurring.router)
app.include_router(webhook_logs.router)
app.include_router(analytics.router)
app.include_router(workflow_rules.router)
app.include_router(assistant.router)
app.include_router(templates.router)
app.include_router(attachments.router)
app.include_router(ws_router.router)


@app.get("/health")
def health():
    return {"status": "ok"}
