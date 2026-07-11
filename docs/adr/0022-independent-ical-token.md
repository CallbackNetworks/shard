# ADR-0022: Independent iCal Token Separate from Share Token

## Status
Accepted

## Date
2026-07-11

## Context
ADR-0021 protected the iCal feed by keying it on the existing per-project
`share_token`, the same secret that unlocks the public `/share/` page. That kept the
change minimal (no new column), but it coupled two distinct capabilities to one
credential: anyone given a project's public share link could derive its calendar feed,
and — more importantly — the two could not be revoked independently. Rotating the token
to cut off a stale calendar subscription would also break every share link, and vice
versa. For a personal tool where these links are handed out separately (a calendar URL
pasted into Apple/Google Calendar vs. a share page sent to a person), independent
revocation is the natural expectation.

## Decision
Give `Project` a dedicated `ical_token` column (unique, uuid4 default), added via Alembic
migration `f7a9c1b3d5e2` with a backfill for existing rows, and serve the feed at
`/ical/{ical_token}.ics`. The `share_token` no longer unlocks the calendar. A new
`POST /projects/{id}/ical-token/rotate` endpoint issues a fresh `ical_token`, invalidating
all existing calendar subscriptions without touching `share_token`; the web UI exposes it
as a "regenerate" button next to the iCal copy button. `ical_token` is returned on the
authenticated `ProjectOut` only — the public share serializer builds its payload
field-by-field and never emits either token.

This supersedes ADR-0021, which reused `share_token`. The event-formatting decisions from
ADR-0021 (timed UTC events, optional `VALARM` reminders, RFC 5545 escaping) are unchanged.

## Consequences
- Positive: the calendar feed and public share page can be revoked independently; leaking
  one does not expose the other.
- Positive: an explicit rotate endpoint/button gives users a clear "kill this calendar
  link" action.
- Negative: adds a column and a migration that must run on existing SQLite/PostgreSQL/MySQL
  databases (the migration is idempotent and backfills tokens for existing projects).
- Negative: iCal URLs generated under ADR-0021 (keyed on `share_token`) stop working and
  must be re-copied. Acceptable — the feature shipped the same day and had no established
  subscribers.
