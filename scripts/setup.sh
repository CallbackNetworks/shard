#!/usr/bin/env bash
# First-time setup and preflight check for Shard.
#
# Everything runs in Docker (see CLAUDE.md); this script only prepares the host
# environment file and verifies prerequisites. It is idempotent — safe to run
# repeatedly. It never overwrites an existing value.
#
# Usage:
#   scripts/setup.sh          # bootstrap .env, generate SECRET_KEY, preflight
#   scripts/setup.sh --check  # verify only; make no changes (exit 1 if not ready)
set -euo pipefail

cd "$(dirname "$0")/.."

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

fail=0

echo "Shard setup"
echo "-----------"

# 1. Prerequisites -----------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  ok "docker found"
else
  err "docker not found — install Docker Engine"; fail=1
fi

if docker compose version >/dev/null 2>&1; then
  ok "docker compose found"
else
  err "docker compose (v2) not found"; fail=1
fi

if docker info >/dev/null 2>&1; then
  ok "docker daemon is running"
else
  warn "docker daemon not reachable — start Docker before 'docker compose up'"
fi

# 2. Environment file --------------------------------------------------------
if [[ -f .env ]]; then
  ok ".env exists"
elif [[ $CHECK_ONLY -eq 1 ]]; then
  err ".env missing — run scripts/setup.sh (without --check) to create it"; fail=1
else
  cp .env.example .env
  ok ".env created from .env.example"
fi

# 3. SECRET_KEY --------------------------------------------------------------
if [[ -f .env ]]; then
  secret_line="$(grep -E '^SECRET_KEY=' .env || true)"
  secret_val="${secret_line#SECRET_KEY=}"
  if [[ -n "$secret_val" ]]; then
    ok "SECRET_KEY is set"
  elif [[ $CHECK_ONLY -eq 1 ]]; then
    warn "SECRET_KEY is empty — an ephemeral per-process secret will be used (PIN sessions reset on restart)"
  else
    new_secret="$(python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null \
      || openssl rand -hex 32)"
    if grep -qE '^SECRET_KEY=' .env; then
      # Portable in-place replace (BSD/GNU sed differ on -i).
      tmp="$(mktemp)"
      sed "s|^SECRET_KEY=.*|SECRET_KEY=${new_secret}|" .env > "$tmp" && mv "$tmp" .env
    else
      printf '\nSECRET_KEY=%s\n' "$new_secret" >> .env
    fi
    ok "SECRET_KEY generated"
  fi
fi

echo
if [[ $fail -ne 0 ]]; then
  err "Not ready — resolve the items above."
  exit 1
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  ok "Ready."
else
  echo "Setup complete. Next:"
  echo "  docker compose up --build     # first run"
  echo "  open http://localhost:5173/app"
fi
