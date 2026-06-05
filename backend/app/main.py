import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import engine
from app.models import Base
from app.routers import (
    activity,
    analytics,
    api_keys,
    assistant,
    attachments,
    bulk,
    cicd,
    comments,
    cycles,
    decisions,
    external_api,
    goals,
    identities,
    integrations,
    labels,
    notifications,
    projects,
    recurring,
    saved_filters,
    search,
    settings,
    share,
    tasks,
    templates,
    webhook_logs,
    webhooks,
    workflow_rules,
)
from app.routers import ws as ws_router
from app.routers.auth import router as auth_router
from app.routers.auth import verify_token
from app.routers.labels import task_label_router
from app.services.scheduler import due_date_reminder_loop
from app.services.search_backend import get_search_backend
from app.services.usage_tracker import UsageTrackingMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    search_backend = get_search_backend()
    search_backend.ensure_index(engine)
    app.state.search_backend = search_backend

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
    "/ical/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/ws",
    "/api/v1/",
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

app.add_middleware(UsageTrackingMiddleware)
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
app.include_router(decisions.router)
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
app.include_router(saved_filters.router)
app.include_router(attachments.router)
app.include_router(notifications.router)
app.include_router(cicd.router)
app.include_router(goals.router)
app.include_router(bulk.router)
app.include_router(settings.router)
app.include_router(ws_router.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health():
    return {"status": "ok"}
