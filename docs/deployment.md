# Deployment

## Prerequisites

- Docker + Docker Compose (v2)
- A domain name or VPS IP address
- (Optional) Reverse proxy: Nginx or Caddy for HTTPS

## Production Setup

### 1. Clone and configure

```bash
git clone <repo> todo-platform
cd todo-platform
```

Create a `.env` file:

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

### 2. Start services

**Production** (recommended):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This starts:
- Backend API on port `8000` (multi-worker uvicorn)
- Frontend on port `80` (nginx serving pre-built static files)

**Development** (with hot-reload):

```bash
docker compose up
```

This starts:
- Backend API on port `8000` (uvicorn with `--reload`)
- Frontend dev server on port `5173` (Vite HMR)

### 3. Verify

```bash
curl http://localhost:8000/health
# → { "ok": true }
```

Visit `http://your-server-ip:5173/` for the public status page and `http://your-server-ip:5173/app` for the management UI.

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

Migrations run automatically on startup via the lifespan handler.

---

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The SQLite database is stored in the `backend_data` named volume and is preserved across rebuilds.

---

## Backups

The database is a single SQLite file in the `backend_data` Docker volume:

```bash
# Backup
docker run --rm \
  -v $(basename $PWD)_backend_data:/data \
  -v $PWD:/backup \
  alpine tar czf /backup/db_backup_$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v $(basename $PWD)_backend_data:/data \
  -v $PWD:/backup \
  alpine tar xzf /backup/db_backup_20260321.tar.gz -C /
```

---

## Data Volumes

| Volume | Contents | Notes |
|---|---|---|
| `backend_data` | SQLite database | Back this up |
| `backend_venv` | Python virtualenv | Recreate on dependency change |
| `frontend_modules` | Node modules | Recreate on package.json change |

To fully reset (loses all data):

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

The `.devcontainer/init-firewall.sh` script (if present) restricts outbound traffic. For production on a VPS, ensure ports `80` and `443` are open inbound, and that the server can reach your SMTP host outbound.

---

## Health Check

```bash
curl https://todo.example.com/health
# → { "ok": true }
```

Use this URL for uptime monitoring or load balancer health checks.
