#!/usr/bin/env bash
# First-run setup wizard for Shard.
#
# Run this once, by hand, to get started — it is meant for people who have not
# used Docker before. It checks prerequisites (and tells you how to install
# Docker if it is missing), walks you through the few settings that matter, and
# can start the app for you. It never overwrites settings you already have.
#
# Usage:
#   scripts/setup.sh          # interactive first-run wizard
#   scripts/setup.sh --check  # verify readiness only; make no changes, no prompts
set -euo pipefail

cd "$(dirname "$0")/.."

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
info()  { printf '    %s\n' "$1"; }

is_tty() { [[ -t 0 && -t 1 ]]; }

# Ask a yes/no question with a default. Non-interactive shells take the default.
ask_yn() {
  local prompt="$1" default="${2:-y}" reply
  if ! is_tty; then
    [[ "$default" == "y" ]]; return
  fi
  local hint="[Y/n]"; [[ "$default" == "n" ]] && hint="[y/N]"
  read -rp "  $prompt $hint " reply || reply=""
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

# Set KEY=VALUE in .env, replacing an existing line or appending a new one.
set_env() {
  local key="$1" val="$2" tmp
  if grep -qE "^${key}=" .env; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

gen_secret() {
  python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null || openssl rand -hex 32
}

docker_install_hint() {
  case "$(uname -s)" in
    Darwin) info "Install Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/" ;;
    Linux)  info "Install Docker Engine: https://docs.docker.com/engine/install/" ;;
    *)      info "Install Docker: https://www.docker.com/get-started/" ;;
  esac
}

# ── Prerequisites ───────────────────────────────────────────────────────────
bold "Shard setup"
echo "Shard runs entirely in Docker — you do not need Python or Node installed."
echo

ready=1

if command -v docker >/dev/null 2>&1; then
  ok "Docker is installed"
else
  err "Docker is not installed."
  docker_install_hint
  info "Install it, then run this script again."
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose is available"
else
  err "Docker Compose (v2) is not available — update Docker to a recent version."
  exit 1
fi

if docker info >/dev/null 2>&1; then
  ok "Docker is running"
else
  err "Docker is installed but not running."
  info "Start Docker Desktop (or the docker service), then run this script again."
  ready=0
fi

# ── --check mode: report and stop ───────────────────────────────────────────
if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ -f .env ]]; then ok ".env exists"; else err ".env is missing — run scripts/setup.sh"; ready=0; fi
  if [[ -f .env ]]; then
    sk="$(grep -E '^SECRET_KEY=' .env || true)"; sk="${sk#SECRET_KEY=}"
    if [[ -n "$sk" ]]; then ok "SECRET_KEY is set"; else warn "SECRET_KEY is empty (ephemeral secret will be used)"; fi
  fi
  echo
  [[ $ready -eq 1 ]] && { ok "Ready."; exit 0; } || { err "Not ready — resolve the items above."; exit 1; }
fi

echo

# ── Environment file ────────────────────────────────────────────────────────
reconfigure=1
if [[ -f .env ]]; then
  ok "Found an existing .env"
  if ask_yn "Keep your current settings and skip the questions?" y; then
    reconfigure=0
  fi
else
  cp .env.example .env
  ok "Created .env from the template"
fi

# ── Guided settings (fresh install or explicit reconfigure) ─────────────────
if [[ $reconfigure -eq 1 ]]; then
  echo
  bold "A couple of quick questions"
  info "Press Enter to accept the default in brackets."
  echo

  # Database: default to SQLite (zero-config).
  info "Storage: SQLite (a single file, no setup). You can switch to PostgreSQL"
  info "or MySQL later by editing DATABASE_URL in .env."
  echo

  # Optional auth.
  if ask_yn "Password-protect the web UI? (recommended if others can reach this machine)" n; then
    pw=""; pw2="x"
    while [[ "$pw" != "$pw2" || -z "$pw" ]]; do
      read -rsp "  Choose a password: " pw; echo
      read -rsp "  Confirm password:  " pw2; echo
      [[ "$pw" != "$pw2" ]] && warn "Passwords did not match, try again."
      [[ -z "$pw" ]] && warn "Password cannot be empty."
    done
    set_env AUTH_PASSWORD "$pw"
    ok "Web UI password set"
  else
    info "No login required — fine for a personal machine on a trusted network."
  fi
fi

# ── SECRET_KEY (always ensure one exists) ───────────────────────────────────
sk="$(grep -E '^SECRET_KEY=' .env || true)"; sk="${sk#SECRET_KEY=}"
if [[ -z "$sk" ]]; then
  set_env SECRET_KEY "$(gen_secret)"
  ok "Generated a SECRET_KEY"
else
  ok "SECRET_KEY already set"
fi

# ── Launch ──────────────────────────────────────────────────────────────────
echo
if [[ $ready -eq 0 ]]; then
  warn "Configuration is ready, but Docker is not running."
  info "Start Docker, then run:  docker compose up --build"
  exit 0
fi

bold "Setup complete."
if is_tty && ask_yn "Start Shard now? (first build can take a few minutes)" y; then
  echo
  info "Running: docker compose up --build"
  info "When it says the servers are ready, open http://localhost:5173/app"
  info "Press Ctrl+C to stop."
  echo
  exec docker compose up --build
else
  echo "When you're ready, start it with:"
  echo "  docker compose up --build     # first run"
  echo "  docker compose up             # afterwards"
  echo "Then open http://localhost:5173/app"
fi
