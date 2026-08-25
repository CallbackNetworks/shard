# Contributing to Shard

Thanks for your interest in improving Shard. This guide covers how to set up the
project, the quality bar, and how changes are reviewed.

## Development environment

Everything runs in Docker with hot-reload — **do not install Python or Node
packages on the host.**

```bash
cp .env.example .env          # then edit as needed
docker compose up --build     # first run / after changing requirements.txt or package.json
docker compose up             # subsequent runs
```

- Backend API + Swagger UI: http://localhost:8000/docs
- Frontend: http://localhost:5173/

See `README.md` and `CLAUDE.md` for the full environment reference.

## Before you open a pull request

Run the same checks CI runs, all inside the containers:

```bash
# Backend
docker compose exec backend ruff check app/ tests/
docker compose exec backend ruff format --check app/ tests/
docker compose exec backend pytest tests/ -v --cov=app --cov-report=term-missing

# Frontend
docker compose exec frontend npm run lint
docker compose exec frontend npx vitest run
```

Requirements for a change to be mergeable:

- **Tests pass on both databases.** SQLite and PostgreSQL are co-equal targets
  (see `docs/adr/0020-databases-as-coequal-test-targets.md`). `scripts/test.sh`
  runs both. New behavior needs tests.
- **Coverage stays at or above 70%** (enforced in CI).
- **Lint and format are clean** (ruff for backend, ESLint for frontend).
- **No non-English text in source code** — comments, identifiers, strings, and
  logs are English-only. Documentation and config files are exempt.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short description>
```

Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`,
`perf`, `ci`. Messages must be in English.

## Architecture Decision Records

Significant architectural decisions are recorded as ADRs under `docs/adr/`. If
your change introduces a security boundary, a storage or protocol choice, a
cross-cutting mechanism, or an accepted trade-off, add an ADR (Michael Nygard
format) and list it in `docs/adr/README.md`. Browse the existing ADRs first —
they explain why the system is the way it is.

## Schema changes

Use Alembic for all schema changes:

```bash
docker compose exec backend sh -c "cd /app && alembic revision --autogenerate -m 'description'"
docker compose exec backend sh -c "cd /app && alembic upgrade head"
```

## Reporting bugs and requesting features

Open an issue using the provided templates. For security issues, do **not** open
a public issue — see [SECURITY.md](SECURITY.md).
