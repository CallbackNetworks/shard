# ADR-0001: CI/CD Tooling

## Status

Accepted

## Date

2026-05-29

## Context

The project needs a CI pipeline that validates code correctness, catches regressions, and ensures production images build successfully. As a single-developer personal project, the pipeline should be fast and low-maintenance.

Two approaches were considered for running tests in CI:

1. **Runner-based**: Install dependencies directly on the GitHub Actions runner (fast, ~30s setup).
2. **Docker-based**: Run all tests inside Docker containers (faithful to the "all deps in Docker" rule, but adds 60-90s of image build time per run).

The project's CLAUDE.md mandates "all deps installed inside Docker, never on host." Strictly applying this to CI would slow every pipeline run.

## Decision

We use **GitHub Actions** as the CI platform with a hybrid approach:

- **Unit tests and linting** run directly on the GitHub Actions runner for fast feedback (~2 min total).
- **Integration smoke test** builds the production Docker images, starts services, and validates health endpoints — ensuring Docker images actually work.

This pragmatic split keeps the fast feedback loop for development while still validating that the Dockerized environment functions correctly.

The CI pipeline consists of four jobs:
1. **Backend tests** — Python linting (ruff), formatting, pytest with coverage, pip-audit
2. **Frontend build** — ESLint, npm audit, Vite production build
3. **Docker dev build** — Validates docker-compose.yml builds all images
4. **Integration smoke test** — Builds production images, starts services, checks health endpoints

## Consequences

- Fast CI feedback: unit tests complete in under 2 minutes.
- Production images are validated on every PR, catching Dockerfile or compose issues early.
- There is a theoretical divergence between runner-installed Python/Node versions and Docker image versions. In practice, both are pinned to the same major versions (Python 3.11, Node 20).
- Adding a new backend route requires no CI changes; adding a new proxied route to the frontend requires updating both `vite.config.js` and `frontend/nginx.conf`.
