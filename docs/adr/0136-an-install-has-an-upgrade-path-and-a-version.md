# ADR-0136: An install has an upgrade path, and says which version it is

## Status
Accepted

## Date
2026-08-31

## Context

[ADR-0117](0117-someone-who-is-not-us-can-run-this.md) shipped the first command a
self-hoster types. It never covered the second one.

`docker-compose.selfhost.yml` builds the production images from the checkout and starts
them. The natural way to move to a newer version is `git pull` followed by
`docker compose -f docker-compose.selfhost.yml up -d --build`, and that command is
wrong in a way nothing announces. [ADR-0064](0064-the-schema-upgrade-needs-a-home.md)
split the schema decision in two: the application creates and *stamps* a database that
does not exist yet, and an existing one is *upgraded* by a separate step,
`python -m app.db_schema`, because the lifespan runs once per uvicorn worker and two
workers would apply the same revisions twice. That step exists in exactly one place —
line 621 of `.github/workflows/ci.yml`, this project's own deploy job.

So a self-hoster's first boot stamps the database at head, and every upgrade after that
runs new code against the schema of the version they first installed. No migration ever
runs on their machine. The containers come up, the health check passes, and a column
that a later revision added is missing until some request touches it. This is not a
hypothetical failure: it is the exact state production was in for months before
ADR-0064, and the reason that ADR describes it as having "no home anywhere" is that a
step which needs a human to remember it is a step nobody runs.

The second half is smaller and compounds it. There was no way for a self-hoster to say
which version they were running: no git tag, no changelog, no endpoint, a version
number in `backend/pyproject.toml` that reached nothing at runtime, and image tags
(`selfhost`, `latest`) that name a channel rather than a build. A bug report from the
outside would have begun with a question neither side could answer.

## Decision

**One command upgrades an instance, and it contains the step that cannot be left out:**
`scripts/upgrade.sh` — pull, build, **migrate**, start, stopping at the first failure.

The migration runs in its own `run --rm --no-deps` container, before `up -d`: the
running stack is still on the old code at that point, and a failing migration must be
able to fail the *upgrade* rather than be a step inside a container already serving
traffic. A database in the `UNTRACKED` state still exits non-zero and still refuses to
guess, which is the whole point of that state.

The script does not replace the deploy job or move the decision out of
`app/db_schema.py`. It is the same three steps in the same order, for the topology that
had no pipeline to put them in.

**The running version is served, not guessed.** `app/version.py` reads
`backend/pyproject.toml` — the file that already declares it — and `settings_admin.read`
reports it, so both API doors and the Settings page show the same number without a
second constant to drift. `docs/CHANGELOG.md` says what changed between versions, and
releases are tagged.

Reading the version from `pyproject.toml` at runtime rather than hardcoding a constant
beside it follows this repository's usual rule about two copies: `Dockerfile.prod` does
`COPY . .`, so the file is in the image, and a build that somehow cannot read it reports
`"unknown"` rather than raising — a version string is a support convenience, and no
request is worth failing over it.

## Consequences

**Positive.** A self-hoster can upgrade without knowing that Alembic exists, and a
migration failure stops the upgrade instead of producing a green stack on a stale
schema. A bug report can name a version. `frontend/package.json` still carries its own
`version` field, but nothing displays it — the number a user sees comes from the
backend, so it describes the process that answered, not the bundle that asked.

**Negative.** `scripts/upgrade.sh` is a third place that knows the self-host topology,
after the compose file and the README. It is documented as the equivalent four commands
so that somebody who prefers to type them can, and so the script is checkable against
what it claims to do.

**Negative.** Anyone who installed before this ADR and has been upgrading with
`up -d --build` has a database stamped at whatever revision they first installed, and
the first `scripts/upgrade.sh` will apply that whole backlog at once. That is the
correct outcome and the only one available; it is worth a line in the changelog rather
than a migration that tries to detect it.
