# Changelog

What changed between versions, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the numbering follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Shard is versioned in one place — `backend/pyproject.toml` — and the running instance
reports it at **Settings → System Status** and in `GET /settings`. Quote that number in
a bug report; an image tag alone (`selfhost`, `latest`) does not identify a build.

Upgrading a self-hosted instance is `scripts/upgrade.sh`. It applies schema migrations,
which `docker compose up -d --build` on its own does not — see
[ADR-0136](adr/0136-an-install-has-an-upgrade-path-and-a-version.md).

## [Unreleased]

### Added

- Published images. `docker compose -f docker-compose.selfhost.yml pull` with
  `SHARD_IMAGE_PREFIX=callbacknetwork/shard` installs a build CI already tested, instead
  of compiling one locally. A version tag names one build forever; `latest` follows
  `main` (ADR-0137). Publishing them is its own CI job, so a public-registry failure
  cannot block a deploy.

### Added

- The project is mirrored to **[github.com/CallbackNetworks/shard](https://github.com/CallbackNetworks/shard)**,
  where issues and pull requests are welcome. GitHub runs the full check suite on its own
  runners with no configuration; publishing and deploying skip themselves there.
- `scripts/upgrade.sh` stops the app and snapshots the database before migrating, keeps
  the last five, and prints the command that restores one (ADR-0140).
- `scripts/diagnose.sh` — one command that collects what a bug report needs: version,
  container status, schema revision, the names of the settings you have set (never their
  values), and recent logs.
- [Concepts](concepts.md) — what nodes, roles, identities, containers and decisions mean,
  for somebody meeting the app for the first time.

### Changed

- **Self-hosted data lives in Docker volumes**, not in `./data` and `./uploads` beside
  the compose file (ADR-0139). Docker seeds a volume from the image, which owns its own
  directories, so the stack starts on any host regardless of the uid running it, and
  `SHARD_UID`/`SHARD_GID` are gone. Copy your data out with **Settings → Backup** or by
  tarring the volume — see the README. *Anyone who installed before this has data in
  `./data`: move it in with `docker run --rm -v shard-selfhost_shard-data:/to -v "$PWD/data:/from" alpine cp -a /from/. /to/` before starting the new version.*

### Fixed

- **The documented install failed on a fresh clone.** `./data` and `./uploads` are
  gitignored bind-mount targets, so Compose asked the daemon to create them and they
  came out root-owned; the backend runs as uid 1000 and died with "unable to open
  database file". The directories are tracked now (contents still ignored), and
  `SHARD_UID`/`SHARD_GID` cover a host whose user is not uid 1000 (ADR-0138). CI now
  performs the documented install on every push, so it cannot break unnoticed again.

### Changed

- The self-host compose names its images `<prefix>-backend` / `<prefix>-frontend` rather
  than `<prefix>/backend`, because a Docker Hub repository has no nested path. A bare
  clone that builds locally is unaffected.

## [1.0.0] — 2026-08-31

First tagged release. The application has been in daily use for months; what this tag
adds is the ability for somebody else to run it, upgrade it, and say which version they
are on.

### Added

- `scripts/upgrade.sh` — build, migrate, restart, in that order, for a self-hosted
  instance. The migration step is the one that cannot be skipped and had no home
  outside the deploy pipeline (ADR-0136).
- The running version is served by `GET /settings` (both API doors) and shown on the
  Settings page, read from `backend/pyproject.toml` rather than copied into a constant.
- This changelog.

### Changed

- CI asks for its runner by repository variable (`CI_RUNNER` / `CD_RUNNER`) instead of a
  hardcoded self-hosted label, and publishing/deploying is gated on a registry being
  configured. A fork with no configuration runs the full check suite on hosted runners
  and skips the deploy jobs (ADR-0135).
- `.claude/mcp.json` no longer carries an absolute path from one machine, so registering
  the stdio MCP server works in any checkout.

### Notes for anyone arriving from the outside

- Shard is **single-user per instance**: one shared password, no accounts, no tenants.
  Running one each is the intended shape, not many people sharing one (ADR-0117).
- The 130-odd ADRs under `docs/adr/` are the reasoning behind most of the code. They are
  written in a mix of English and Traditional Chinese.
