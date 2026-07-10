# ADR-0016: Guest Notes on Public Share Pages

## Status
Accepted

## Date
2026-07-10

## Context
Share links (identity- and project-scoped) were strictly read-only: anonymous
visitors could watch progress but had no way to participate. The real needs
observed are two: "I found something / I want something" (submitting a new
item) and "I have something to say about this task" (commenting). A full
guest-submission pipeline (dedicated inbox table, triage statuses,
accept/dismiss workflow, submission-tracking tokens, reactions) was considered
and rejected as over-machinery for a personal tool where guest volume is a
handful of notes per week.

## Decision
Introduce a single primitive: the **guest note**, a plain comment written by a
share-link visitor.

- **Reuse the `comments` table.** A new nullable `guest_name` column marks a
  note as guest-authored; `task_id` becomes nullable so a note with
  `task_id=NULL` attaches to the project itself. A project-level note is how a
  visitor "submits an issue" — no new table, model, or triage state machine.
- **Two endpoints** under the existing share router:
  `POST /share/{scope}/{token}/notes` (project-level) and
  `POST /share/{scope}/{token}/tasks/{task_id}/notes` (task-level), where
  scope is `identity` or `project`.
- **Opt-in per share link.** New `allow_guest_notes` boolean on both
  `identities` and `projects`, default off, toggled through the existing
  PATCH endpoints and surfaced in the share-settings UI.
- **Two-way visibility when enabled.** Turning the flag on also makes task
  comment threads and project notes visible on the share page. This is a
  deliberate trade-off: a conversation requires both sides to be readable, and
  the closed feedback loop (visitor returns and sees replies/progress next to
  their note) is what creates participation. When the flag is off, only
  comment counts are exposed, as before.
- **Abuse controls reuse existing mechanisms:** the share rate limiter, PIN
  session verification for PIN-protected identity links (the `share_session`
  cookie), Pydantic length limits (name ≤ 80, body ≤ 2000), and a daily cap of
  20 notes per hashed visitor IP enforced by counting `share.note` activity
  log rows — no new counter table.
- **No owner-side machinery.** Notes surface through the existing comments
  panel and activity log (`share.note`, actor `visitor:<ip-hash>`). Promoting
  a note to a task is a manual act.

## Consequences
- Positive: visitors can participate with one field and one text box; the
  feedback loop closes for free because notes render on the share page they
  already visit; total schema impact is two columns plus two flags.
- Positive: every control (rate limit, PIN, expiry, per-link toggle) already
  existed; disabling the flag instantly returns a link to read-only.
- Negative: enabling guest notes exposes existing owner comments on shared
  tasks. Owners must be aware that the toggle widens read scope, not just
  write scope.
- Negative: guest notes are anonymous and unauthenticated by design; identity
  is a self-reported name. If volume ever grows beyond human triage, the
  rejected inbox/moderation design can be layered on top without schema
  changes (notes are ordinary comments).
- The daily quota keys on hashed IPs that rotate with a daily salt, so a
  determined visitor on rotating IPs can exceed it; accepted for a
  personal-scale tool.
