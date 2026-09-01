#!/usr/bin/env bash
# Collect what a bug report needs, and nothing that should not leave your machine.
#
# The point is that the answer to "what version, what state, what error" arrives with
# the report instead of after three rounds of questions. It prints to stdout; redirect
# it to a file and attach that, or paste it.
#
# It prints the *names* of the settings you have set, never their values: .env holds
# an LLM key, an SMTP password and the MCP token, and a diagnostic that quietly asks
# you to publish those is worse than no diagnostic at all.
#
# Usage:
#   scripts/diagnose.sh                # the self-host stack
#   scripts/diagnose.sh --dev          # the development stack
#   scripts/diagnose.sh > report.txt
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.selfhost.yml
[[ "${1:-}" == "--dev" ]] && COMPOSE_FILE=docker-compose.yml

section() { printf '\n===== %s =====\n' "$1"; }
compose() { docker compose -f "$COMPOSE_FILE" "$@" 2>&1; }

section "Shard"
echo "compose file:  $COMPOSE_FILE"
if [[ -d .git ]]; then
  echo "commit:        $(git log -1 --format='%h %s' 2>/dev/null || echo unknown)"
  echo "tag:           $(git describe --tags --always 2>/dev/null || echo none)"
fi
echo "declared:      $(sed -n 's/^version = "\(.*\)"/\1/p' backend/pyproject.toml | head -1)"

section "Host"
uname -a
echo "docker:        $(docker --version 2>&1)"
echo "compose:       $(docker compose version 2>&1)"

section "Containers"
compose ps

section "Reported by the running app"
# Through the container rather than a published port: the port may be bound to the
# loopback of a machine this is not being run from, and /api/settings carries no
# secrets by construction (services/settings_admin.py).
compose exec -T backend python -c "
import json, urllib.request
try:
    with urllib.request.urlopen('http://localhost:8000/api/settings', timeout=5) as r:
        d = json.load(r)
    for k in ('version','auth_mode','smtp_configured','llm_provider','llm_model','mcp_transport'):
        print(f'{k:18} {d.get(k)}')
except Exception as exc:
    print('could not reach the app:', exc)
" || echo "backend is not running"

section "Database"
compose exec -T backend python -c "
import os
from app.database import engine
from app import db_schema
print('url dialect      ', engine.dialect.name)
print('schema state     ', db_schema.schema_state(engine))
print('schema revision  ', db_schema.current_revision(engine))
print('data dir         ', os.listdir('/app/data')[:10])
" || echo "backend is not running"

section "Settings you have set (names only, never values)"
if [[ -f .env ]]; then
  grep -oE '^[A-Z_][A-Z0-9_]*=' .env | tr -d '=' | while read -r k; do
    v=$(grep -m1 "^$k=" .env | cut -d= -f2-)
    [[ -n "$v" ]] && echo "  $k is set" || echo "  $k is empty"
  done
else
  echo "  no .env file — everything is on its default"
fi

section "Volumes"
docker volume ls --filter name=shard 2>&1

section "Last 50 backend log lines"
compose logs --tail=50 backend

section "Last 20 frontend log lines"
compose logs --tail=20 frontend

printf '\n===== end =====\n'
