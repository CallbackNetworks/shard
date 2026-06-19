FROM python:3.11-slim

WORKDIR /app

# Install uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install deps into venv first (cached layer — only re-runs when requirements change)
COPY requirements.txt .
RUN uv venv .venv && uv pip install --upgrade pip wheel && uv pip install -r requirements.txt

RUN mkdir -p /app/data

ENV PATH="/app/.venv/bin:$PATH"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
