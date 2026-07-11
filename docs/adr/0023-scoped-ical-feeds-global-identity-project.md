# ADR-0023: Scoped iCal Feeds — Global (Personal), Identity, and Project

## Status
Accepted

## Date
2026-07-11

## Context
ADR-0021 and ADR-0022 both framed the calendar feed as per-project: 0021 reused the
project `share_token`, 0022 gave each project a dedicated `ical_token` for independent
revocation. Revisiting how the feed is actually used surfaced that the per-project framing
was wrong for the dominant case:

- **For myself**, I want to see *everything*. Subscribing project-by-project is tedious and
  breaks the moment I create a new project — I would have to add its URL by hand. What I
  want is one URL that always covers all projects.
- **For sharing with others**, I hand out a *specific scope* — a project or an identity —
  and its calendar naturally belongs to that same share. There is no scenario where I want
  to revoke a shared project's calendar but keep its share page (or vice versa); they are
  one act of sharing.

Once split this way, the dedicated per-project `ical_token` from ADR-0022 has no remaining
use case: personal use is served by an aggregate feed, and shared use rides on the existing
`share_token`. So the independent token solved a problem that does not occur in practice.

## Decision
Replace the single per-project feed with three scoped, read-only feeds, each gated by an
unguessable token (all under the auth-bypassed `/ical/` prefix so calendar clients need no
login):

- `GET /ical/all/{token}.ics` — **personal**: every due-dated task across all projects.
  Gated by a single app-level token stored in `user_preferences` (key `ical-global-token`),
  auto-generated on first use, rotatable via `POST /settings/ical-token/rotate`. Surfaced in
  Settings as a "Calendar Feed" card. This is the "subscribe once to everything" URL.
- `GET /ical/identity/{token}.ics` — **shared**: all projects under one identity, keyed on
  `Identity.share_token` (the same token as its `/share/` page). Surfaced on the Identities
  page.
- `GET /ical/project/{token}.ics` — **shared**: one project, keyed on `Project.share_token`
  (the same token as its `/share/` page). Surfaced on the project header.

Token-management endpoints (`GET/POST /settings/ical-token…`) live under the authenticated
`/settings/` prefix, deliberately separate from the public `/ical/` feeds. The
`Project.ical_token` column from ADR-0022 is dropped (migration `a1c3e5f7b9d2`). Event
formatting (timed UTC events, optional `VALARM`, RFC 5545 escaping) is unchanged from
ADR-0021.

This supersedes ADR-0022 (and, transitively, ADR-0021).

## Consequences
- Positive: one stable personal URL shows all projects and auto-includes new ones — the
  common case is now one action, not N.
- Positive: shared calendars are consistent with the existing share model — same token,
  same lifecycle, revoked together with the share page. No extra token to reason about.
- Positive: the public share serializer never emits tokens, and only the aggregate feed's
  token is management-gated behind `/settings/`; leaking one scope's URL does not expose
  another.
- Negative: two schema migrations churned in one day (add `ical_token`, then drop it). The
  drop is idempotent and safe on existing SQLite/PostgreSQL/MySQL databases.
- Negative: no per-project independent revocation — a shared project's calendar can only be
  revoked by rotating its `share_token` (which also rotates the share page). Accepted as the
  correct trade-off for this tool's sharing model.
- Trade-off: the global feed is a single app-wide credential with no per-identity scoping;
  anyone given that URL sees every project. It is only ever meant for personal use, and it
  can be rotated from Settings.
