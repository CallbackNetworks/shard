#!/usr/bin/env bash
# Recapture the tutorial screenshots from the running app (ADR-0148).
#
# The guide's pictures are generated, not curated. `docs/screenshots/` was captured
# by hand once and then aged out of the product it documents — two layout ADRs later,
# every image showed a UI that no longer existed and nothing said so. A picture that
# can be regenerated in one command is a picture that stays true; one that cannot is
# documentation with an expiry date nobody wrote down.
#
# Both destinations are written in the same pass, because they cannot be one file:
# `frontend/Dockerfile.prod`'s build context is `./frontend`, so an image under
# `docs/` can never reach the SPA build. The app ships its own copy in
# `frontend/public/guide/`; the repo docs keep theirs in `docs/screenshots/`.
#
# Everything runs in Docker (see CLAUDE.md). The dev stack must be up:
#   docker compose up
#
# Usage:
#   scripts/screenshots.sh                    # capture everything
#   scripts/screenshots.sh -g overview        # only the specs matching a name

set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker compose ps --status running --services | grep -qx frontend; then
  echo "The dev stack is not running. Start it first:" >&2
  echo "  docker compose up" >&2
  exit 1
fi

# The bind mounts land as the container's user, and this container runs as root.
# Creating the directories from the host first means the PNGs arrive owned by the
# person who will commit them, rather than by root — the same class of ownership
# trap ADR-0138/0139 hit with the data directory, in miniature.
mkdir -p frontend/public/guide docs/screenshots

before=$(find frontend/public/guide -name '*.png' | wc -l)

# The e2e image bakes its specs in with `COPY . .`, so a spec edited on the host is
# invisible to a plain `run` — it reports "No tests found" and exits 1, which reads
# like a bad filter rather than a stale image.
echo "==> Building the e2e image"
docker compose --profile e2e build e2e

echo "==> Capturing guide screenshots against the dev stack"
docker compose --profile e2e run --rm \
  -e GUIDE_SHOTS=1 \
  -e "SHOT_UID=$(id -u)" \
  -e "SHOT_GID=$(id -g)" \
  e2e npx playwright test guide-shots "$@"

after=$(find frontend/public/guide -name '*.png' | wc -l)
echo
echo "==> ${after} images in frontend/public/guide (was ${before})"
git status --short frontend/public/guide docs/screenshots || true
echo
echo "Review the images, then commit them — they ship inside the frontend build."
