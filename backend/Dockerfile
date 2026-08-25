FROM python:3.11-slim

WORKDIR /app

# uv, pinned by digest. `:latest` here was the one floating tag in the whole build,
# and it sat on the layer that installs every dependency — the thing most worth being
# able to reproduce. The 0.12.6 tag is for humans; the digest is what actually holds.
COPY --from=ghcr.io/astral-sh/uv:0.12.6@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d /uv /usr/local/bin/uv

# Install deps into venv first (cached layer — only re-runs when requirements change)
COPY requirements.txt requirements.lock ./
RUN uv venv .venv && uv pip install --upgrade pip wheel && uv pip install -r requirements.lock

COPY . .

# Non-root. uid 1000 rather than a fresh id, because this image bind-mounts the host
# checkout and writes into ./data and ./uploads — a container user that does not match
# the host owner cannot write to either, and the failure shows up as a runtime error
# deep in a request instead of at startup. Override with `--build-arg APP_UID=` if the
# host user is not 1000.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd -g ${APP_GID} app 2>/dev/null || true \
 && useradd -u ${APP_UID} -g ${APP_GID} -m -s /bin/bash app 2>/dev/null || true \
 && mkdir -p /app/data /app/uploads \
 && chown -R ${APP_UID}:${APP_GID} /app

ENV PATH="/app/.venv/bin:$PATH"

USER app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
