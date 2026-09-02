# Contributing to Shard

Thanks for your interest in improving Shard. This guide covers how to set up the
project, the quality bar, and how changes are reviewed.

## Where this repository lives

GitHub is a **push mirror**. Development happens on a private Gitea instance, and every
push from there overwrites the GitHub branches — which means a commit made *on* GitHub,
including a merge commit from GitHub's own merge button, is erased by the next sync.

So: open issues and pull requests here, and expect them to be **applied upstream rather
than merged here**. Your commits keep their authorship and appear on GitHub on the next
sync, usually within the hour. If your pull request closes without a GitHub merge commit,
that is why — check `main` for your change.

The CI you see on a pull request is the real suite: with no repository variables set it
runs entirely on GitHub-hosted runners, and the publish and deploy jobs skip themselves
(see [ADR-0135](../docs/adr/0135-the-pipeline-runs-on-somebody-elses-machine-too.md)).

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
- **Coverage stays at or above the floor in `backend/pyproject.toml`**
  (`[tool.coverage.report] fail_under`, currently 78%). Both database jobs read
  that same value, and so does a local `pytest --cov` — there is no second copy
  in the workflow to keep in step.
- **Lint and format are clean** (ruff for backend, ESLint for frontend).
- **No non-English text in source code** — comments, identifiers, strings, and
  logs are English-only. Documentation and config files are exempt.

## Continuous integration

Opening a pull request runs the whole suite — backend lint/format/audit, the backend
tests against **both** SQLite and PostgreSQL, frontend lint/tests/audit/build, and a
production-image integration smoke test with Playwright.

The jobs ask for their runner by repository variable:
`runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`. A fork needs no configuration —
with the variable unset the checks run on GitHub-hosted runners. The maintainer's own
instance sets `CI_RUNNER` / `CD_RUNNER` to its self-hosted labels. See
[ADR-0135](../docs/adr/0135-the-pipeline-runs-on-somebody-elses-machine-too.md).

The `publish` and `deploy` jobs are skipped unless a `REGISTRY_URL` variable is set, so
a fork never has two jobs waiting on a registry and a deploy host it does not have.
Seeing them greyed out on your PR is the expected result, not a failure.

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
