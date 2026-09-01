# Deployment

This document is about two different things, and which one applies to you depends on how
you got here:

- **Self-hosting your own instance** — one compose file, one command, and one upgrade
  command. Jump to [Self-hosting](#self-hosting).
- **The maintainer's CD pipeline**, described below, which is how *this* project's own
  production host is deployed. It is not something a self-hoster needs.

**Production is deployed by the CD pipeline, not by hand.** Pushing to `main` runs
`.github/workflows/ci.yml`, which builds the `Dockerfile.prod` images, publishes them to the
registry, and then — on the `CD_RUNNER` runner — *writes* both the `.env` and the compose
file into `$DEPLOY_DIR` before pulling and starting the stack. Nothing you place in that
directory by hand survives a deploy; the pipeline overwrites both files every time.

There is deliberately no production compose file in this repo. The old `docker-compose.prod.yml`
was a compose *override*, and an override merges lists rather than replacing them — it could
never remove the dev stack's bind mounts, so it never did what its comments claimed. See
ADR-0108.

This document therefore covers two things: what the pipeline does (so you can reason about a
deploy), and how to run the production images locally when you need to verify one.

## Prerequisites

- Docker + Docker Compose (v2)
- A domain name or VPS IP address
- (Optional) Reverse proxy: Nginx or Caddy for HTTPS

## Configuration

Deploy-time configuration comes from Gitea repository variables and secrets, which the deploy
job renders into `$DEPLOY_DIR/.env` (`ci.yml`, "Write .env"). For local runs, create a `.env`
file in the project root — it is gitignored and is the single source of truth for compose:

```env
AUTH_PASSWORD=choose_a_strong_password

# SMTP (optional, for email notifications)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASS=smtp_password
SMTP_FROM=notifications@example.com
SMTP_USE_TLS=true

# LLM assistant (optional)
LLM_PROVIDER=claude          # claude | openai | stub
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6  # or gpt-4o for OpenAI

# Daily summary email hour (UTC, default 8)
SUMMARY_HOUR=8
```

## What a deploy does

The `deploy` job runs only on a push to `main`, and only after backend checks, both database
test jobs, the frontend job, integration and publish have all passed:

1. **Write `.env`** into `$DEPLOY_DIR` from Gitea variables and secrets.
2. **Generate `docker-compose.yml`** into the same directory. Two services, both by image tag —
   no build, no source mounts. `backend` only `expose`s 8000 (it is not published to the host);
   `frontend` binds `127.0.0.1:${FRONTEND_PORT:-80}:80` so nginx is the only public door.
   There is no `mcp` service — remote MCP is a route on the backend (ADR-0080).
3. **Pull** the `:sha` images.
4. **Apply migrations** with `docker compose run --rm --no-deps backend python -m app.db_schema`.
   This runs as its own step, *before* the containers are swapped — see "Database Migrations".
5. **`up -d --remove-orphans`**, then poll `/health` until the backend answers.

`$DEPLOY_DIR` defaults to `/opt/deployments/<repo-name>` and is overridable with the
`DEPLOY_DIR` repository variable.

## Self-hosting

The whole install is one file and one command; it builds the production images from the
checkout, so it needs no registry account and no `.env` to boot:

```bash
git clone <this repo> && cd shard
docker compose -f docker-compose.selfhost.yml up -d
# http://127.0.0.1:8090/
```

Your data is the two directories beside the compose file: `./data` (the SQLite database and
its backups) and `./uploads` (attachments). Copy those two and you have copied the instance.
See [ADR-0117](adr/0117-someone-who-is-not-us-can-run-this.md).

### Pulling instead of building

The compose file carries `image:` beside `build:`, so the same file installs either way.
Point it at the published images and Compose stops building:

```bash
SHARD_IMAGE_PREFIX=callbacknetwork/shard    # <namespace>/shard, giving shard-backend / shard-frontend
SHARD_TAG=1.0.0                             # a version tag never moves; `latest` follows main
```

```bash
docker compose -f docker-compose.selfhost.yml pull
docker compose -f docker-compose.selfhost.yml up -d
```

Publishing them is the `publish` job's second half, switched on by `PUBLIC_REGISTRY_URL`
— see the variables table below and [ADR-0137](adr/0137-the-images-are-published-where-somebody-can-pull-them.md).

### Upgrading

```bash
scripts/upgrade.sh
```

**Do not upgrade with `docker compose up -d --build` alone.** It rebuilds the images and
starts them against a database that is however many revisions behind. The application
creates and *stamps* a fresh database but never migrates an existing one — that split is
deliberate (see "Database Migrations" below) — so a plain rebuild leaves new code running
on an old schema, with no startup error and no failed health check. The symptom arrives
later, inside one request, as a missing column.

`scripts/upgrade.sh` is the same three steps in the order that makes a failure stop the
upgrade: build, migrate, start. By hand it is:

```bash
git pull
docker compose -f docker-compose.selfhost.yml build
docker compose -f docker-compose.selfhost.yml run --rm --no-deps backend python -m app.db_schema
docker compose -f docker-compose.selfhost.yml up -d
```

Which version you are on is shown at **Settings → System Status** and served by
`GET /settings`. Quote it in a bug report — an image tag (`selfhost`, `latest`) does not
identify a build. Changes between versions are in [the changelog](CHANGELOG.md).

### CI/CD for your own fork

The workflow asks for its runner by repository variable, so a fork runs the checks on
GitHub-hosted runners with no configuration at all (ADR-0135). To point it at your own
infrastructure, set these repository variables:

| Variable | Effect |
|----------|--------|
| `CI_RUNNER` | Label the check jobs ask for. Unset → `ubuntu-latest` |
| `CD_RUNNER` | Label the deploy job asks for. Unset → `ubuntu-latest` |
| `REGISTRY_URL` | The private registry the deploy job pulls from. **Also a switch**: unset, nothing is published there and `deploy` is skipped |
| `DEPLOY_DIR` | Where the deploy job writes `.env` and the generated compose file |
| `PUBLIC_REGISTRY_URL` | The public registry, e.g. `docker.io`. **Also a switch**: unset, no public image is published |
| `PUBLIC_REGISTRY_USERNAME` | Account to log in as there |
| `PUBLIC_REGISTRY_NAMESPACE` | Namespace the images go under, giving `<ns>/shard-backend` and `<ns>/shard-frontend` |

`publish` runs if *either* registry is configured; with neither (the fork case), both it
and `deploy` are skipped. The one secret is `PUBLIC_REGISTRY_TOKEN`.

## Running the production images locally

This is what CI's `integration` job does, and it is the supported way to verify a production
build before pushing:

```bash
docker compose -f docker-compose.ci.yml --profile integration up --build backend-prod frontend-prod
```

- Backend API on port `8000` (single-worker uvicorn — see ADR-0101)
- Frontend on port `80` (nginx serving pre-built static files)

**Development** (with hot-reload):

```bash
docker compose up
```

This starts:
- Backend API on port `8000` (uvicorn with `--reload`)
- Frontend dev server on port `5173` (Vite HMR)

### Verify

```bash
curl http://localhost:8000/health
# → {"status":"ok","scheduler":{"alive":true,"last_tick_at":"..."}}
```

Visit `http://your-server-ip:5173/` for the management UI. (It used to live under `/app`; the routes moved to the root in June 2026 and that path now renders an empty shell.)

---

## Nginx Reverse Proxy

Serve both the frontend and backend through a single domain:

```nginx
server {
    listen 80;
    server_name todo.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name todo.example.com;

    ssl_certificate     /etc/letsencrypt/live/todo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/todo.example.com/privkey.pem;

    # Frontend (React)
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Backend API (FastAPI)
    location ~ ^/(projects|tasks|integrations|identities|api-keys|activity|webhook|auth|health|api|docs|openapi|redoc|search|analytics|templates|workflow-rules|assistant|share|deliveries|attachments) {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Get a certificate with Certbot:

```bash
certbot --nginx -d todo.example.com
```

---

## Caddy (Simpler Alternative)

```
todo.example.com {
    reverse_proxy /ws localhost:8000
    reverse_proxy /projects* localhost:8000
    reverse_proxy /tasks* localhost:8000
    reverse_proxy /integrations* localhost:8000
    reverse_proxy /identities* localhost:8000
    reverse_proxy /api-keys* localhost:8000
    reverse_proxy /activity* localhost:8000
    reverse_proxy /webhook* localhost:8000
    reverse_proxy /auth* localhost:8000
    reverse_proxy /health localhost:8000
    reverse_proxy /api* localhost:8000
    reverse_proxy /docs* localhost:8000
    reverse_proxy /openapi.json localhost:8000
    reverse_proxy /search* localhost:8000
    reverse_proxy /analytics* localhost:8000
    reverse_proxy /templates* localhost:8000
    reverse_proxy /workflow-rules* localhost:8000
    reverse_proxy /assistant* localhost:8000
    reverse_proxy /share* localhost:8000
    reverse_proxy /deliveries* localhost:8000
    reverse_proxy /* localhost:5173
}
```

Caddy handles HTTPS automatically.

---

## Database Migrations

Schema changes are managed with Alembic (configured with `render_as_batch=True` for SQLite compatibility):

```bash
# Generate a migration after modifying models.py
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'add new column'"

# Apply migrations
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

**Migrations do not run on startup.** `app/db_schema.py` owns the decision and recognises three
states (ADR-0064):

- `FRESH` (no `nodes` table) — the app's lifespan runs `create_all()` and *stamps* the Alembic
  head. The root revision is a no-op baseline, so replaying the chain would `ALTER` tables
  nothing created.
- `MANAGED` (has `alembic_version`) — gets upgraded.
- `UNTRACKED` (tables but no `alembic_version`) — refuses and exits non-zero rather than guess.

The upgrade runs as its own deploy step, not in the lifespan: the lifespan runs once per uvicorn
worker, and concurrent upgrades would apply the same revisions twice.

```bash
# What the deploy job runs, after pull and before up -d
docker compose run --rm --no-deps backend python -m app.db_schema
```

---

## Updating

**A self-hosted instance:** `scripts/upgrade.sh` — see [Upgrading](#upgrading). The step that
matters is the migration, and a plain `up -d --build` does not run it.

**This project's own production host:** push to `main`. The pipeline builds, publishes,
migrates and restarts (see "What a deploy does").

Application data lives in the `./data` host bind mount inside `$DEPLOY_DIR`, not in a named
volume, so it is untouched by image pulls and container recreation.

---

## Backups

The app has a built-in backup service (`app/services/backup.py`, ADR-0013): the scheduler writes
a daily archive to `BACKUP_DIR` (default `/app/data/backups`, i.e. `./data/backups` on the host),
retaining `BACKUP_KEEP` of them. Status, manual runs, export, download and restore are reachable
from Settings and from `/api/v1` — restore requires `admin` scope and a `confirm="replace"` gate
(ADR-0091).

To take a copy by hand, archive the host directory that holds the database:

```bash
# Backup — run from $DEPLOY_DIR on the deploy host (or the project root locally)
tar czf db_backup_$(date +%Y%m%d).tar.gz data/

# Restore — stop the stack first so nothing is mid-write
docker compose down
tar xzf db_backup_20260321.tar.gz
docker compose up -d
```

> The database defaults to SQLite (`./data/shard.db`). If `DATABASE_URL` points at PostgreSQL or
> MySQL, back that server up with its own tooling — `./data` will then hold only uploads and
> backup archives.

---

## Data Volumes

| Path / volume | Contents | Notes |
|---|---|---|
| `./data` (host bind) | SQLite database, uploads, backup archives | **Back this up.** Not a named volume — it survives `down -v` |
| `backend_venv` | Python virtualenv (dev stack only) | Recreate on `requirements.txt` change |
| `frontend_modules` | Node modules (dev stack only) | Recreate on `package.json` change |
| `postgres_data` / `mysql_data` | Optional bundled database servers | Only with the `postgres` / `mysql` profile |

To reset the named volumes (does **not** remove `./data` — delete that directory separately if
you really want to lose the database):

```bash
docker compose down -v
```

To reset only node modules (safe):

```bash
docker compose down
docker volume rm $(basename $PWD)_frontend_modules
docker compose up --build -d
```

---

## Firewall

For production on a VPS, ensure ports `80` and `443` are open inbound, and that the server can
reach your SMTP host and any configured LLM endpoint outbound. The generated compose file binds
the frontend to `127.0.0.1`, so the reverse proxy in front of it is what decides public exposure;
the backend is never published to the host at all.

---

## Health Check

```bash
curl https://todo.example.com/health
# → {"status":"ok","scheduler":{"alive":true,"last_tick_at":"2026-08-22T06:28:42.528958+00:00"}}
```

`scheduler.alive` is the useful field beyond liveness: the reminder, digest, retry, SLA and
backup sweeps all run on that one asyncio loop, so a process that answers `200` with a dead
scheduler is serving pages while doing none of its background work.

Use this URL for uptime monitoring or load balancer health checks.
