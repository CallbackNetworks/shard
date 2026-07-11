# ADR-0029: Milestone ↔ Cycle Sync

## Status
Accepted

## Date
2026-07-11

## Context
Shard cycles and external milestones (GitHub, Gitea, GitLab) are the same
concept under different names: a named, time-boxed bucket of work items that
drives sprint progress. The issue-sync track already mirrors status, title,
description, comments, labels, and due dates (ADR-0014/0015/0026/0027), and can
create issues from tasks — but "which sprint is this in" never crossed the
boundary. A task's cycle membership and its issue's milestone drifted
independently.

Two model mismatches made this non-trivial and required product decisions:

1. **Inbound with no matching cycle** — an issue can arrive carrying a milestone
   Shard has no cycle for. Auto-create a cycle, or ignore it?
2. **Date shape** — a milestone has one due date; a cycle has a start and an end.
3. **Cardinality** — an issue has exactly one milestone slot, but a Shard task
   can belong to several cycles.
4. **Provider payloads** — github.com and Gitea include the milestone title
   inline in the issue webhook; GitLab's issue hook carries only a numeric
   `milestone_id`, not the title.

## Decision
Map cycles to milestones **by name**, with no new stored mapping — consistent
with the project's preference for one reused primitive over new machinery.

- **Inbound (decision 1 = map-to-existing):** when an issue carries a milestone,
  add the task to a cycle of the same name **only if one already exists**; never
  auto-create a cycle. Inbound is additive: a cleared milestone does not remove
  the task from any cycle, so external events cannot clobber manual Shard-side
  cycle assignment. Implemented for github.com/Gitea, where the title is in the
  payload; GitLab inbound is out of scope (title absent from the hook).
- **Outbound (decision 2 = end_date):** cycle membership drives the issue
  milestone. On add/remove the milestone is recomputed from current state:
  find-or-create a milestone named after the task's cycle, with the cycle's
  `end_date` as the milestone due date, and set it on the issue; when the task
  is in no cycle, the milestone is cleared. Works for all three providers.
- **Cardinality (decision 3):** when a task is in several cycles, the
  earliest-created cycle deterministically drives the single milestone slot.

## Consequences
Positive:
- Sprint membership now round-trips: assigning a task to a cycle groups its
  issue under the matching milestone, and (for github.com/Gitea) a milestoned
  issue lands in the matching cycle. This was the last open item in the sync
  track's original priority list.
- No new tables or mapping state; name equality is the whole contract, and
  outbound recomputes from DB state so add and remove share one code path.
- Map-to-existing + additive inbound means external activity can never silently
  spawn cycles or unassign sprints in Shard.

Negative:
- Name-based mapping is exact-match and case-sensitive; renaming a cycle or
  milestone breaks the link until names agree again.
- GitLab inbound milestone→cycle is unsupported (the issue hook lacks the title;
  resolving it would need an extra API call in the webhook path). Outbound to
  GitLab works.
- A task in multiple cycles collapses to one milestone (earliest cycle);
  the reverse — one milestone fanning out to multiple cycles — is not modeled.
- Milestone is synced on cycle add/remove, not retroactively when an issue is
  first created from an already-cycled task; it propagates on the next
  membership change.
