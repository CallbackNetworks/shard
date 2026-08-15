#!/bin/sh
# Launch the MCP server over stdio for a local MCP client (Claude Code, Claude Desktop).
#
# The server is a module inside the backend package (ADR-0080), so this runs it in the
# already-running backend container — no separate image, no separate service.
#
# Which Shard it talks to is this script's only real decision, and it is deliberate:
#   SHARD_TARGET=prod  (default)  → https://shard.callbacknetwork.com, real data
#   SHARD_TARGET=dev              → the local backend, seed data
#
# The API key is read from a file outside the repo and passed as an environment variable,
# never written into .claude/mcp.json — that file is tracked, and a credential in a tracked
# file is a credential in the history.
set -eu

KEY_FILE="${SHARD_API_KEY_FILE:-$HOME/.claude/shard-api-key}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "${SHARD_TARGET:-prod}" in
  dev)  BASE_URL="http://localhost:8000" ;;
  prod) BASE_URL="https://shard.callbacknetwork.com" ;;
  *)    BASE_URL="$SHARD_TARGET" ;;
esac

# A key is valid against exactly one database, so the target picks the key too: the dev
# stack's own key lives in .env, production's in the file outside the repo. Getting this
# backwards produces a 401 that reads like a broken server rather than the wrong key.
DEV_KEY=""
if [ "${SHARD_TARGET:-prod}" = "dev" ] && [ -r "$REPO_ROOT/.env" ]; then
  DEV_KEY=$(sed -n 's/^MCP_API_KEY=//p' "$REPO_ROOT/.env" | head -1)
fi

if [ -n "${SHARD_API_KEY:-}" ]; then
  KEY="$SHARD_API_KEY"
elif [ -n "$DEV_KEY" ]; then
  KEY="$DEV_KEY"
elif [ -r "$KEY_FILE" ]; then
  KEY=$(cat "$KEY_FILE")
else
  echo "No API key: set SHARD_API_KEY or put one in $KEY_FILE (mint it at /app/api-keys)." >&2
  exit 1
fi

exec docker compose -f "$(dirname "$0")/../docker-compose.yml" exec -T \
  -e MCP_TRANSPORT=stdio \
  -e API_BASE_URL="$BASE_URL" \
  -e API_KEY="$KEY" \
  backend python -m app.mcp_server.server
