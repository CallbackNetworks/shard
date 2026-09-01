#!/usr/bin/env bash
# Upgrade a self-hosted Shard instance to the current checkout.
#
# There is one step in here that cannot be left out and has no failure symptom if it
# is: the schema upgrade. `docker compose up -d --build` on its own rebuilds the
# images and starts them against a database that is however many revisions behind —
# the application only creates and stamps a *fresh* database, never migrates an
# existing one (ADR-0064 explains why that split exists), so a self-hoster who pulls
# and restarts runs new code on an old schema. That is exactly the state production
# was in for months before ADR-0064, and it does not announce itself: the containers
# come up green and a column that is missing surfaces later, inside one request.
#
# So: build, migrate, start — in that order, and stop at the first failure rather
# than starting a stack whose migration did not apply.
#
# Usage:
#   scripts/upgrade.sh            # pull the latest code, then upgrade
#   scripts/upgrade.sh --no-pull  # upgrade to whatever is already checked out
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.selfhost.yml
PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose is not available. See scripts/setup.sh --check."
  exit 1
fi

if [[ "$PULL" == "1" ]]; then
  bold "1/4  Fetching the latest code"
  if [[ -d .git ]]; then
    git pull --ff-only
    ok "checkout updated"
  else
    ok "not a git checkout — skipping (use --no-pull to silence this)"
  fi
else
  bold "1/4  Using the current checkout (--no-pull)"
fi

bold "2/4  Building images"
docker compose -f "$COMPOSE_FILE" build

# Before `up`, and in its own container: the running stack is still on the old code,
# and this must be able to fail the upgrade rather than be a step inside a container
# that is already serving. A database that has tables but no `alembic_version` exits
# non-zero here on purpose — it needs a human, not a guess.
bold "3/4  Applying schema migrations"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps backend python -m app.db_schema

bold "4/4  Starting"
docker compose -f "$COMPOSE_FILE" up -d

printf '\n'
ok "Upgrade complete. Version now running:"
docker compose -f "$COMPOSE_FILE" exec -T backend python -c \
  'from app.version import version; print("   ", version())' 2>/dev/null || true
