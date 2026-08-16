import asyncio
import json
import logging
import os
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect as sa_inspect

logger = logging.getLogger(__name__)
from starlette.middleware.base import BaseHTTPMiddleware

from app import db_schema
from app.database import engine
from app.models import Base
from app.routers import (
    activity,
    analytics,
    api_keys,
    assistant,
    attachments,
    backup,
    bulk,
    cicd,
    comments,
    cycles,
    decisions,
    external_api,
    focus,
    goals,
    graph_types,
    identities,
    imports,
    integrations,
    issue_sync,
    labels,
    nodes,
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
from app.routers import auth as auth_mod
from app.routers import ws as ws_router
from app.routers.auth import router as auth_router
from app.routers.labels import task_label_router
from app.services import node_data
from app.services.errors import ServiceError
from app.services.scheduler import due_date_reminder_loop, get_scheduler_health
from app.services.search_backend import get_search_backend
from app.services.usage_tracker import UsageTrackingMiddleware


def _build_mcp_transport():
    """Remote MCP, served by this process (ADR-0080).

    Registered only when `MCP_HTTP_TOKEN` is set. ADR-0076's rule is unchanged —
    a half-configured public endpoint is not a state worth serving — only where it
    is enforced: the route is never registered rather than the service never being
    generated. The failure mode improves with it: the path is *absent* (404), not
    present with nothing behind it (502).

    The import is inside the branch so a deployment without remote MCP does not pay
    for the SDK at startup.
    """
    if not os.environ.get("MCP_HTTP_TOKEN"):
        return None
    from app.mcp_server.server import create_http_app

    return create_http_app()


_mcp_transport = _build_mcp_transport()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creating a schema is the only half of this the application does. Upgrading an
    # existing one is a deploy step, because the lifespan runs once per uvicorn worker
    # and concurrent upgrades would apply the same revisions twice — app/db_schema.py
    # holds both halves of the decision (ADR-0064).
    fresh_db = db_schema.schema_state(engine) == db_schema.FRESH
    Base.metadata.create_all(bind=engine)
    if fresh_db and not sa_inspect(engine).has_table(db_schema.VERSION_TABLE):
        try:
            db_schema.stamp_head()
        except Exception as exc:
            logger.warning("Could not stamp alembic head on fresh database: %s", exc)
    # Seed built-in node/edge type vocabulary (idempotent; ADR-0033).
    from app.database import SessionLocal
    from app.services.graph_registry import seed_builtin_types

    with SessionLocal() as _seed_db:
        try:
            seed_builtin_types(_seed_db)
        except Exception as exc:
            logger.warning("Could not seed built-in graph types: %s", exc)

    search_backend = get_search_backend()
    search_backend.ensure_index(engine)
    app.state.search_backend = search_backend

    _scheduler_task = asyncio.create_task(due_date_reminder_loop())

    # The MCP session manager is started by the transport app's own lifespan, and a
    # route endpoint never sees a lifespan scope — so this process has to enter it.
    # Skipping it is not a startup failure: every /mcp request fails at runtime with
    # no manager to route to.
    async with AsyncExitStack() as stack:
        if _mcp_transport is not None:
            await stack.enter_async_context(_mcp_transport.lifespan())
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
    "/api/auth/",
    "/health",
    "/webhook/",
    "/share/",
    "/ical/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/ws",
    "/api/v1/",
    # Remote MCP carries its own bearer token (ADR-0076) and its clients are not
    # browsers — the SPA's password gate has no session to offer them.
    "/mcp",
)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not auth_mod.auth_enabled():
            return await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in _AUTH_BYPASS):
            return await call_next(request)
        auth_header = request.headers.get("authorization", "")
        token = auth_header.removeprefix("Bearer ").strip()
        if not auth_mod.is_authenticated(request, token):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)


class CredentialRedactionMiddleware(BaseHTTPMiddleware):
    """No ``/api/v1`` response carries a capability token unless the key is ``admin``.

    A share token and a CI callback token are authority, not description: either one lets
    the holder act. ``/webhook/callback/{token}`` is deliberately unauthenticated and skips
    its signature check when a task has no ``webhook_secret``, so a ``read``-scope key that
    could list tokens held a working write path — the least privilege in the system
    escalating to task mutation (ADR-0059).

    Enforced here, on the finished response, rather than in each endpoint: v1 has a dozen
    response shapes and will grow more, and a rule applied per-endpoint is one a new
    endpoint can simply be written without. The invariant is a property of the response,
    so it is checked on the response.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/api/v1"):
            return response
        scopes = getattr(request.state, "api_key_scopes", None)
        # No scopes recorded means the request never reached the key dependency (a 401, a
        # 404, an unauthenticated probe) — nothing that carries a node payload.
        if scopes is None or "admin" in scopes:
            return response
        if response.headers.get("content-type", "").split(";")[0] != "application/json":
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            return Response(content=body, status_code=response.status_code, headers=dict(response.headers))
        return JSONResponse(
            content=jsonable_encoder(node_data.strip_tokens(payload)),
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() not in ("content-length",)},
        )


app = FastAPI(
    title="Shard",
    version="1.0.0",
    description=API_DESCRIPTION,
    openapi_tags=tags_metadata,
    lifespan=lifespan,
)


def _cors_origins() -> list[str]:
    """Allowed CORS origins, from CORS_ORIGINS (comma-separated) or dev defaults.

    Deployments serving the frontend from another origin must set CORS_ORIGINS;
    the default only covers the local Vite dev/preview ports.
    """
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173")
    return [o.strip() for o in raw.split(",") if o.strip()]


app.add_middleware(UsageTrackingMiddleware)
app.add_middleware(AuthMiddleware)
# Added last, so it wraps outermost and sees the finished body of every v1 response.
app.add_middleware(CredentialRedactionMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Internal API consumed by the SPA — namespaced under /api so frontend page routes
# never collide with backend paths (ADR-0036). External contracts (webhook callbacks,
# public share/ical links, the /api/v1 external API, websocket) keep their root paths.
api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router)
api_router.include_router(projects.router)
api_router.include_router(tasks.router)
api_router.include_router(tasks.task_ops_router)
api_router.include_router(integrations.router)
api_router.include_router(labels.router)
api_router.include_router(task_label_router)
api_router.include_router(decisions.router)
api_router.include_router(cycles.router)
api_router.include_router(api_keys.router)
api_router.include_router(activity.router)
api_router.include_router(identities.router)
api_router.include_router(focus.router)
api_router.include_router(comments.router)
api_router.include_router(search.router)
api_router.include_router(recurring.router)
api_router.include_router(webhook_logs.router)
api_router.include_router(analytics.router)
api_router.include_router(workflow_rules.router)
api_router.include_router(assistant.router)
api_router.include_router(templates.router)
api_router.include_router(saved_filters.router)
api_router.include_router(attachments.router)
api_router.include_router(notifications.router)
api_router.include_router(cicd.router)
api_router.include_router(goals.router)
api_router.include_router(graph_types.router)
api_router.include_router(nodes.router)
api_router.include_router(nodes.graph_router)
api_router.include_router(bulk.router)
api_router.include_router(imports.router)
api_router.include_router(settings.router)
api_router.include_router(backup.router)
app.include_router(api_router)

# Root-level: external contracts + infrastructure (must keep their public paths).
app.include_router(webhooks.router)  # /webhook/* inbound CI/CD callbacks
app.include_router(issue_sync.router)  # /webhook/issues/* inbound issue sync
app.include_router(external_api.router)  # /api/v1/* external API (X-API-Key auth)
app.include_router(share.router)  # /share/* public share pages
app.include_router(bulk.ical_router)  # /ical/* calendar subscriptions
app.include_router(ws_router.router)  # /ws websocket

# Remote MCP (ADR-0080). Appended as a raw route rather than an `include_router`
# because the endpoint is an ASGI app, not an `APIRouter`; `mcp_route` owns the
# exact shape (a `Route`, not a `Mount`; a class, not a function) and explains why.
if _mcp_transport is not None:
    from app.mcp_server.server import mcp_route

    app.router.routes.append(mcp_route(_mcp_transport))


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError):
    """One rendering of a service-layer refusal, so the internal and v1 doors onto the same
    act cannot answer it differently (ADR-0085). Neither router writes this response."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health():
    return {"status": "ok", "scheduler": get_scheduler_health()}
