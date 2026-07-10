# ADR-0017: PR Signal Sync — Signals In, Content Stays External

## Status
Accepted

## Date
2026-07-10

## Context
After ADR-0014/0015 made issue sync fully duplex, pull requests remained the
weakest link: a PR referencing "Fixes #N" had its URL appended as plain text to
the task description (a design debt ADR-0015 already flagged, since later
description edits push that text into the issue body), PR opened/closed events
carried no task signal beyond merge-completes-task, and review activity was
invisible in Shard.

Linear's trajectory (2025 Pull Request Reviews: diffs and review threads
rendered in-app) shows one possible endpoint: absorb PR content until the tool
replaces the forge UI. For a single-user platform whose agent workflow is
"assign task → agent opens PR → owner reviews", the daily question is *"which
PRs need my attention?"* — answering it requires signals, not content. Building
a diff viewer and review-thread mirror would duplicate what Gitea/GitHub
already render best.

## Decision
Split PR data along the compute-vs-view line (the same test applied in the
sync-vs-link discussion): **lifecycle and review signals are synced; PR content
is never mirrored** — the stored `pr_url` is the jump-off point, and the
review itself happens on the forge (or any external review service).

Concretely:

- A new `task_pull_requests` table replaces description-append linking:
  one row per (task, repo, pr_number) holding url, title, branch,
  `state` (open/merged/closed) and `review_state` (review_requested/approved/
  changes_requested/commented). Tasks expose it as `pull_requests` in
  `TaskOut`; the UI renders state-colored badges that open `pr_url` in a new
  tab.
- `pull_request` webhook: opened/reopened moves a todo task to in_progress;
  closed-merged marks the link merged and completes tasks (existing behavior);
  closed-unmerged marks the link closed and raises an in-app notification —
  a discarded PR is a signal the owner must see, not silence.
- `pull_request_review` webhook (submitted): updates `review_state`;
  approved / changes_requested raise in-app notifications whose link points
  at the external PR page. `review_requested` on the PR event does the same.
- Tasks are matched by "Fixes #N" refs in the PR body plus existing
  `task_pull_requests` rows, so review events on PRs without refs still land.
  The legacy description-URL fallback for merge-completion is kept for tasks
  linked before this change.

## Consequences
Positive: "which PRs await me" is now answerable inside Shard (badges +
notifications) while zero forge UI is duplicated; the description no longer
accumulates link text, closing ADR-0015's noted side effect. The signal set
matches the agent workflow (ADR-0009): agent PRs surface as actionable
notifications.

Negative: `pull_request_review` is a GitHub/Gitea event — GitLab merge
requests are not covered (its MR webhook shape differs; a future adapter can
map onto the same table). Old tasks keep their appended "Linked PR" text in
descriptions; only the fallback path reads it. Multiple PRs per task render at
most two badges in the row UI.
