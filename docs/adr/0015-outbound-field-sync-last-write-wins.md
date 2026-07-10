# ADR-0015: Outbound Field Sync with Last-Write-Wins Semantics

## Status
Accepted

## Date
2026-07-09

## Context
After ADR-0014, comments, labels, and open/close state were fully duplex, but
the issue's core fields were still one-way: inbound webhooks overwrote task
title/description/assignee, while edits made in Shard never reached the
external issue. Working from Shard still meant title or description edits
silently diverged from the issue.

Field-level sync forces a conflict-resolution choice. The robust options
(vector clocks, updated_at comparison, three-way merge) all require storing
per-field sync state and handling clock skew across servers — heavy machinery
for a single-user platform where the same person edits both sides.

A GitLab-specific wrinkle: its API assigns issues by numeric `assignee_ids`,
while Shard stores the assignee as a username string, so outbound assignee
sync needs a username-to-id lookup.

## Decision
Push task field changes (title, description, assignee) to the linked external
issue on task update, with **last-write-wins in both directions**: inbound
issue events overwrite the task (existing behavior), outbound edits overwrite
the issue via `PATCH /issues/{n}` (GitHub-compatible) or `PUT .../issues/:iid`
(GitLab). Only fields that actually changed in the request are included in the
outbound payload, so an inbound-refreshed field is never accidentally pushed
back stale.

Assignee mapping: GitHub-compatible providers take `assignees: [username]`
directly (empty list to unassign). For GitLab, the username is resolved via
`GET /users?username=` at push time; if the lookup fails, the assignee field is
dropped from the payload while other changed fields still sync.

No echo protection is needed: the webhook echo of an outbound PATCH applies
identical values inbound, and the inbound path never triggers outbound pushes
(same structural guarantee as ADR-0014).

## Consequences
Positive: title, description, and assignee now converge from either side,
completing field-level duplex on top of ADR-0014. No new schema, no sync-state
storage; concurrent-edit conflicts resolve deterministically (latest event
wins), which matches single-user reality.

Negative: simultaneous edits on both sides within one webhook round-trip lose
one side's change without warning — accepted for a single-user deployment.
The PR-link text appended to task descriptions by PR sync will be pushed into
the issue body if the description is later edited in Shard. A GitLab assignee
whose username has no exact match is silently skipped rather than surfaced as
an error.
