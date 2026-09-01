# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability), or, if that is unavailable to you, email
**lynloveyounever@gmail.com**. Either way, include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- affected version or commit.

You can expect an initial acknowledgement within a few days. Once the issue is
confirmed and a fix is available, the report will be resolved and, with your
consent, credited.

## Deployment hardening

Shard is a **single-user system per instance**: one shared password, no accounts,
no tenants. Everyone who can log in sees and can change everything, so "who is
allowed in" is the whole of the access model. When exposing it beyond localhost,
review the following:

- **Set `SECRET_KEY`.** It signs share-PIN session cookies. If unset, an
  ephemeral per-process secret is used and PIN sessions reset on restart; a
  fixed, known value must never be used in production.
- **Set `AUTH_PASSWORD`** to require authentication for `/app`. It is empty by
  default (no auth), which is only appropriate for trusted local use.
- **Set `CORS_ORIGINS`** to your actual frontend origin(s). The default only
  permits local Vite dev/preview ports.
- **Protect backups like the database.** Backup archives contain secrets
  (webhook secrets, API-key hashes) in plain JSON — store and transfer them
  accordingly (see `docs/adr/0013-full-data-backup-strategy.md`).
- **Rotate tokens.** API keys, share tokens, iCal tokens, and MCP tokens can be
  rotated; do so if one may have leaked.

## Scope

The `/api/v1` external API is authenticated solely by `X-API-Key` (scoped
`read`/`write`/`admin`). Public share and iCal endpoints are token-protected and
rate-limited; treat their tokens as secrets.
