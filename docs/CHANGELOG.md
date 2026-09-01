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
  `main` (ADR-0137).

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
