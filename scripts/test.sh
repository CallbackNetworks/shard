#!/usr/bin/env bash
# Run the backend test suite against SQLite and/or PostgreSQL.
#
# SQLite and PostgreSQL are equal, parallel test targets. Everything runs inside
# Docker (see CLAUDE.md); this script only needs bash + docker on the host.
# The dev stack must be up (`docker compose up`). PostgreSQL tests use an
# isolated `shard_test` database and never touch the app's data.
#
# Usage:
#   scripts/test.sh              # both databases (default)
#   scripts/test.sh sqlite       # SQLite only
#   scripts/test.sh postgres     # PostgreSQL only
#   scripts/test.sh both -k foo  # extra args after the target go to pytest

set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-both}"
[ $# -gt 0 ] && shift || true
pytest_args=("$@")

PG_TEST_URL="postgresql+psycopg://todo:todo_dev@postgres:5432/shard_test"

run_sqlite() {
  echo "==> Backend tests against SQLite (in-memory)"
  docker compose exec -T -e TEST_DATABASE_URL=sqlite:///:memory: \
    backend pytest tests/ --tb=short "${pytest_args[@]}"
}

run_postgres() {
  echo "==> Backend tests against PostgreSQL (isolated shard_test DB)"
  docker compose --profile postgres up -d postgres
  echo "    waiting for postgres..."
  for _ in $(seq 1 30); do
    docker compose exec -T postgres pg_isready -U todo >/dev/null 2>&1 && break
    sleep 1
  done
  # Create the throwaway test database if it does not exist yet.
  docker compose exec -T postgres createdb -U todo -O todo shard_test 2>/dev/null || true
  docker compose exec -T -e TEST_DATABASE_URL="$PG_TEST_URL" \
    backend pytest tests/ --tb=short "${pytest_args[@]}"
}

case "$target" in
  sqlite)   run_sqlite ;;
  postgres) run_postgres ;;
  both)     run_sqlite; run_postgres ;;
  *) echo "Unknown target: $target (expected sqlite | postgres | both)" >&2; exit 2 ;;
esac
