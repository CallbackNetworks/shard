# ADR-0025: Project Share-Link Expiry and Access Audit

## Status
Accepted

## Date
2026-07-11

## Context
Public share links are the platform's only unauthenticated surface. Identity
share links already support a PIN, an expiry timestamp (`share_expires_at`,
enforced with HTTP 410), and a view-count audit derived from `share.viewed`
rows in `activity_logs`. Project share links, added later, had none of this:
a project link, once created, was valid forever and left no access trail.

As more link types were added (project shares, guest notes, scoped iCal feeds),
the asymmetry became a real gap: a project link handed to a contractor or pasted
into a ticket could not be time-boxed or monitored, even though the equivalent
identity link could.

## Decision
Bring project share links to parity with identity links on the two controls
that matter for an unauthenticated surface — expiry and audit — while
deliberately not adding a project PIN (out of scope; identity is the pinned
entry point).

- Add a nullable `share_expires_at` column to `projects` (Alembic migration
  `b2d4f6a8c0e3`), exposed on `ProjectOut`.
- Enforce expiry in `GET /share/project/{token}` and on the guest-note write
  path, returning 410 once past the timestamp — the same shape as identity.
- Log project-share views to `activity_logs` as `share.viewed` with
  `meta.project_id`, throttled to one row per visitor IP-hash per hour, mirroring
  the identity view logger. As with identity views, no `project_id` column is
  set on the row, so these do not appear in the project activity feed.
- Add `POST /projects/{id}/set-expiry` and `GET /projects/{id}/share-views`,
  matching the identity endpoints, and a compact "Link" control in
  ProjectDetail to set expiry and read the view count.

Audit reuses the existing `activity_logs` primitive rather than introducing a
new table, consistent with how identity views and guest notes are already
recorded.

## Consequences
Positive:
- Project links can now be time-boxed and their usage counted, closing the
  asymmetry with identity links.
- No new storage concept: expiry is one nullable column, audit is existing
  activity rows, so the surface a maintainer must reason about does not grow.
- Behavior is symmetric with identity shares, verified on both SQLite and
  PostgreSQL (ADR-0020).

Negative:
- The view count is a coarse audit (throttled per IP-hash per hour, IP hashed
  with a daily salt): it approximates reach, not exact hits, and cannot identify
  a visitor. This is intentional for a personal tool but is not forensic.
- Expiry gates the `/share/` page and guest notes, not the scoped iCal feed,
  which carries its own independent `ical_token` (ADR-0022/0023). Revoking a
  share link and revoking a calendar subscription remain separate actions.
- Project links still have no PIN; a leaked unexpired link is readable until it
  expires or the token is rotated.
