# Troubleshooting

## Start here

```bash
scripts/diagnose.sh            # the self-host stack
scripts/diagnose.sh --dev      # the development stack
```

One command for the questions every problem starts with: which version, which containers
are up, which schema revision the database is on, which settings are set, and what the
last log lines say. It prints setting *names* only, never their values, so the output is
safe to paste into an issue.

## An upgrade went wrong

`scripts/upgrade.sh` stops the app and snapshots the database before it migrates, keeping
the last five (ADR-0140). To go back to the snapshot it took, with the app stopped:

```bash
docker compose -f docker-compose.selfhost.yml stop
docker run --rm --volumes-from "$(docker compose -f docker-compose.selfhost.yml ps -aq backend)" \
  -v shard-snapshots:/in alpine:3.20 \
  sh -c 'rm -rf /app/data/* && tar xzf /in/pre-upgrade-<stamp>.tgz -C /app/data'
docker compose -f docker-compose.selfhost.yml up -d
```

List what is there with:

```bash
docker run --rm -v shard-snapshots:/out alpine:3.20 ls -l /out
```

Then check out the version you were on before and run `scripts/upgrade.sh --no-pull`, or
the old code will migrate it forward again.

## Common Issues

### Frontend shows blank page or 502

**Cause**: Backend is not running or hasn't finished starting.

**Fix**: Check backend logs and wait for startup to complete:

```bash
docker compose logs -f backend
```

Look for `Uvicorn running on http://0.0.0.0:8000`. If it's crashing, check for Python import errors or missing dependencies.

### Vite proxy errors (ECONNREFUSED)

**Cause**: The Vite dev server can't reach the backend container.

**Fix**: Ensure both containers are on the same Docker network and the backend is healthy:

```bash
curl http://localhost:8000/health
```

If the backend URL differs from the default, set `BACKEND_URL` in `.env`.

### Frontend dependency changes not taking effect

**Cause**: The `node_modules` Docker volume caches old dependencies.

**Fix**: Remove the volume and rebuild:

```bash
docker compose down
docker volume rm 20260318_frontend_modules
docker compose up --build
```

### SQLite "database is locked" errors

**Cause**: Multiple processes writing to SQLite simultaneously (rare in normal use).

**Fix**: The database is configured with WAL mode and `busy_timeout=5000`. If you still see lock errors:

1. Ensure only one backend instance is running
2. Restart the backend: `docker compose restart backend`
3. Check for zombie processes: `docker compose ps`

### Tests fail with "table already exists"

**Cause**: Test database state leaked between test runs.

**Fix**: Tests use in-memory SQLite with `StaticPool`. Each test session gets a fresh database. If you see stale state:

```bash
docker compose exec backend python -m pytest --forked -q
```

### Alembic "target database is not up to date"

**Cause**: Pending migrations haven't been applied.

**Fix**:

```bash
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

### WebSocket connection drops repeatedly

**Cause**: The frontend auto-reconnects after 3 seconds. Frequent drops usually mean the backend is restarting or the proxy isn't configured for WebSocket upgrade.

**Fix**: In development, Vite handles WS proxy automatically. In production, ensure your reverse proxy (nginx/Caddy) forwards the `/ws` path with WebSocket upgrade headers.

### Auth token invalid after backend restart

**Cause**: Session tokens are stored in memory. A backend restart clears all active sessions.

**Fix**: Log in again. This is expected behavior for a personal tool.

### ESLint reports hundreds of "unused vars" warnings

**Cause**: ESLint's built-in `no-unused-vars` rule doesn't track JSX element usage. Variables used only as JSX tags (`<Component />`) appear unused.

**Fix**: This is a known limitation. The warnings are false positives for React components. The CI threshold is set to 300 to accommodate this.

### MCP server can't connect to backend

**Cause**: The MCP server connects to the backend via `http://localhost:8000` by default.

**Fix**: If running inside Docker, use the container hostname instead. Set `MCP_API_KEY` in `.env` and ensure an API key with `admin` scope exists.
