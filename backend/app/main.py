import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import engine
from app.models import Base
from app.routers import projects, tasks, webhooks, integrations, labels, cycles, api_keys, external_api, activity, identities
from app.routers.labels import task_label_router
from app.routers.auth import router as auth_router, verify_token


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
        conn.commit()
    yield


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
    "/docs",
    "/openapi.json",
    "/redoc",
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


@app.get("/health")
def health():
    return {"status": "ok"}
