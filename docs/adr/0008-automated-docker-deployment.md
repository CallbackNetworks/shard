# ADR-0008: Automated Docker Deployment via CD Pipeline

## Status

Accepted

## Date

2026-06-19

## Context

The project had a complete CI pipeline (lint, test, integration smoke test) and a publish step that pushes production Docker images to a self-hosted registry. However, deployment to the production machine was manual — an operator had to SSH in, pull the latest images, and restart services.

The team already operates a `cd-deployer` Gitea runner on the target machine (validated by the `ci-smoketest` project). The goal is to automate deployment so that every successful push to `main` results in a live update without manual intervention.

Two approaches were considered:

1. **Checkout-based**: Clone the repo on the deployer, use `docker-compose.prod.yml` overlay, pull images.
2. **Generated compose**: Generate a minimal `docker-compose.yml` on the deployer with pinned image tags — no repo checkout needed.

## Decision

We use the **generated compose** approach. The `deploy` job in `.github/workflows/ci.yml`:

1. Runs on `cd-deployer` after the `publish` job succeeds (main branch only).
2. Logs into the self-hosted Docker registry.
3. Generates a `docker-compose.yml` at `~/deployments/todo-platform/` with image tags pinned to the commit SHA.
4. Pulls the new images and brings services up with `--remove-orphans`.
5. Waits for backend health check and verifies frontend responds.

Environment configuration (database URL, SMTP, auth, etc.) is read from `~/deployments/todo-platform/.env`, which is pre-configured on the deployer machine and not managed by CI.

## Consequences

- Every push to `main` that passes CI is automatically deployed — zero manual steps.
- Image tags are pinned to commit SHAs, providing full traceability from running container back to source.
- The deployer machine requires a pre-configured `.env` file; this is a one-time setup but means environment changes are out-of-band from the pipeline.
- Rollback is possible by re-running a previous workflow or manually changing the image tag in the generated compose file.
- No repo checkout on the deployer means fewer attack surface and no source code on the production machine.
- The `backend_data` volume persists SQLite data across deployments; database migrations run automatically on startup via the lifespan handler.
