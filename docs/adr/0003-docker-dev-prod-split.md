# ADR-0003: Docker Dev/Prod Split

## Status

Superseded by ADR-0108

(Only the compose-override half is superseded. The separate dev/prod Dockerfiles decided here
remain in force and in use.)

## Date

2026-05-29

## Context

The project originally had only development Dockerfiles — the backend ran `uvicorn --reload` (single-worker dev mode) and the frontend ran `npm run dev` (Vite dev server with HMR). These are unsuitable for production: dev servers are slower, less secure, and not designed for concurrent users.

A single Dockerfile with build args to switch between dev and prod modes was considered, but this approach creates larger images (dev tools included in prod) and more complex build logic.

## Decision

Use **separate Dockerfiles** for development and production, combined with Docker Compose's **override file** pattern:

- `Dockerfile` (dev): Existing dev setup with hot-reload, used by default `docker-compose.yml`.
- `Dockerfile.prod` (prod): Multi-stage builds optimized for size and security.

**Backend production** (`backend/Dockerfile.prod`):
- Two-stage build: builder installs deps with `uv`, runtime copies only `.venv` and app code.
- Runs `uvicorn --workers 2` without `--reload`.
- Sets `PYTHONDONTWRITEBYTECODE=1` and `PYTHONUNBUFFERED=1`.

**Frontend production** (`frontend/Dockerfile.prod`):
- Two-stage build: Node builder runs `npm run build`, runtime uses `nginx:1.27-alpine` to serve static files.
- Nginx handles SPA fallback routing and API reverse proxy to the backend.

**Compose override** (`docker-compose.prod.yml`):
```bash
# Development (default)
docker compose up

# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The prod override replaces build contexts with `Dockerfile.prod`, removes source volume mounts, and the frontend serves on port 80 via nginx.

## Consequences

- Production images are smaller and faster (no dev tools, node_modules, or source mounts).
- The frontend is served by nginx, which handles static asset caching, gzip, and SPA routing efficiently.
- Two Dockerfiles per service to maintain. Changes to dependency installation must be reflected in both.
- The MCP server is placed behind a `profiles: [mcp]` gate in production since it's optional.
- New backend API routes must be added to `frontend/nginx.conf`'s proxy location block (in addition to `vite.config.js` for development).
