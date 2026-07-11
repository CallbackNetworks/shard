# ADR-0021: Token-Protected iCal Feed via Reused Project Share Token

## Status
Superseded by ADR-0022

## Date
2026-07-11

## Context
The iCal subscription feed (`/ical/...`) lets external calendar apps (Apple Calendar,
Google Calendar) subscribe to a project's task due dates. The original endpoint was
keyed on the raw `project_id` (`/ical/{project_id}.ics`) with no authentication, and it
is deliberately excluded from the auth middleware so unauthenticated calendar clients can
poll it. Because `project_id` values are surfaced throughout the app and its URLs, anyone
who saw a project id could read that project's task titles, descriptions, and due dates.

We also wanted the feed to be genuinely useful in a calendar: the original output emitted
all-day events (`DTSTART;VALUE=DATE`) with no time and no reminders, even though tasks
carry a full `due_date` timestamp.

Forces at play:
- The endpoint must stay unauthenticated at the middleware layer (calendar clients cannot
  present the app login or an API key).
- We prefer reusing existing primitives over adding new columns/machinery.
- The output must remain valid RFC 5545 so third-party calendars parse it.

## Decision
Key the feed on the existing per-project `share_token` (`/ical/{share_token}.ics`) instead
of `project_id`. The token is already an unguessable secret that gates read-only project
access via the `/share/` pages, so no new column, migration, or credential scheme is
introduced — the iCal feed simply becomes another read-only view behind the same secret.
An unknown token returns 404.

The event generation was upgraded in the same change:
- Timed events (`DTSTART`/`DTEND` in UTC) derived from `start_date`/`due_date`, replacing
  all-day events. Point-in-time due dates get a default 30-minute block.
- An optional `VALARM` reminder, lead time controlled by the `alarm` query parameter
  (minutes, default 30, `0` disables). Reminders are emitted only for open tasks
  (not `done`/`failed`).
- Proper RFC 5545 TEXT escaping of `\ ; ,` and newlines, plus `DTSTAMP`, `LAST-MODIFIED`,
  `CALSCALE`, `METHOD`, and `X-WR-CALNAME` for a well-formed, nicely-named calendar.

The feed remains one-way and read-only; two-way sync (CalDAV, Google Tasks) is out of scope.

## Consequences
- Positive: task data is no longer exposed by knowing a `project_id`; the feed reuses the
  same secret and revocation story as share pages (rotating `share_token` invalidates both).
- Positive: subscribed calendars now show real times and fire reminders, making the feed
  actually useful.
- Negative: existing `/ical/{project_id}.ics` subscription URLs break and must be
  re-copied from the UI. This is intentional — those URLs were the insecure surface.
- Trade-off: the iCal feed and the public share page share one token, so they cannot be
  revoked independently. Acceptable given both expose the same read-only project data.
