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
# The order is: build, stop, snapshot, migrate, start — stopping at the first failure.
# Stopping before the snapshot is what makes the snapshot worth having: SQLite in WAL
# mode copied out from under a running process is a torn file, and a torn file is not
# a rollback. It also means the migration runs with nothing else writing (ADR-0140).
#
# Usage:
#   scripts/upgrade.sh            # pull the latest code, then upgrade
#   scripts/upgrade.sh --no-pull  # upgrade to whatever is already checked out
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=docker-compose.selfhost.yml
SNAPSHOT_VOLUME=shard-snapshots
SNAPSHOTS_KEPT=5
PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

if ! docker compose version >/dev/null 2>&1; then
  err "Docker Compose is not available. See scripts/setup.sh --check."
  exit 1
fi

if [[ "$PULL" == "1" ]]; then
  bold "1/5  Fetching the latest code"
  if [[ -d .git ]]; then
    git pull --ff-only
    ok "checkout updated"
  else
    ok "not a git checkout — skipping (use --no-pull to silence this)"
  fi
else
  bold "1/5  Using the current checkout (--no-pull)"
fi

bold "2/5  Building images"
compose build

bold "3/5  Stopping the app"
compose stop
ok "stopped — nothing is writing to the database now"

# Taken with the stack down, and stored in a Docker volume rather than a host directory
# for the ADR-0139 reason: a path this script would have to create is created as root.
# `--volumes-from` copies the backend container's own mounts, so this cannot name the
# wrong volume even if the project was brought up under a different name.
bold "4/5  Snapshotting the data"
BACKEND_CID="$(compose ps -aq backend || true)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
if [[ -n "$BACKEND_CID" ]]; then
  docker run --rm --volumes-from "$BACKEND_CID" -v "$SNAPSHOT_VOLUME:/out" alpine:3.20 \
    sh -c "tar czf /out/pre-upgrade-$STAMP.tgz -C /app/data . && \
           ls -1t /out/pre-upgrade-*.tgz | tail -n +$((SNAPSHOTS_KEPT + 1)) | xargs -r rm -f"
  ok "saved as pre-upgrade-$STAMP.tgz in the '$SNAPSHOT_VOLUME' volume (last $SNAPSHOTS_KEPT kept)"
  # Printed with the lookup rather than the id it just used: `up -d` below replaces the
  # container, so a literal id would be stale by the time anybody reads this.
  printf '    To roll the database back to it — stop the app first:\n'
  printf '      docker run --rm --volumes-from "$(docker compose -f %s ps -aq backend)" \\\n' "$COMPOSE_FILE"
  printf '        -v %s:/in alpine:3.20 \\\n' "$SNAPSHOT_VOLUME"
  printf '        sh -c '"'"'rm -rf /app/data/* && tar xzf /in/pre-upgrade-%s.tgz -C /app/data'"'"'\n' "$STAMP"
else
  warn "nothing installed yet — no snapshot to take"
fi

# In its own container, before the app starts: a failing migration must be able to fail
# the upgrade rather than run inside something already serving. A database that has
# tables but no `alembic_version` exits non-zero here on purpose — it needs a human,
# not a guess.
bold "5/5  Migrating and starting"
compose run --rm --no-deps backend python -m app.db_schema
compose up -d

printf '\n'
ok "Upgrade complete. Version now running:"
compose exec -T backend python -c 'from app.version import version; print("   ", version())' 2>/dev/null || true
