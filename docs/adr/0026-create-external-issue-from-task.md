# ADR-0026: Create External Issue from a Shard Task

## Status
Accepted

## Date
2026-07-11

## Context
The issue-sync track (ADR-0014, ADR-0015, ADR-0017) made Shard mirror external
issues in both directions — but only for issues that already existed. Every
linked task began life as an inbound webhook from GitHub/GitLab; a task created
in Shard first had no way to become an external issue. This was the last gap
versus tools like Linear, where "create issue in the linked repo" is a first-
class action.

Two design questions had to be answered:

1. **Where does the target repo come from?** Inbound sync learns the repo from
   the webhook payload. For an outbound create there is no payload, so we need a
   stored source. Projects already carry `repo_url` (ADR added with
   `fa6bfeefbe1f`), which is the natural home.
2. **Which provider?** Linked tasks store `external_provider` from the webhook.
   A new task has none, and self-hosted hosts are ambiguous (Gitea speaks the
   GitHub API; a GitLab instance may sit on any hostname).

## Decision
Add an explicit `POST /projects/{id}/tasks/{task_id}/create-external-issue`
action. Unlike field sync (last-write-wins, ADR-0015), this treats the task as
the source of truth for a brand-new issue — it is a deliberate user action, not
a background reconciliation.

- Target repo is parsed from `projects.repo_url` by `parse_repo_url`, which
  returns provider, `owner/repo` (or GitLab namespace path), and the API base.
  Provider defaults to GitLab when the host looks like GitLab, otherwise
  GitHub-compatible (github.com, GHE, Gitea share one REST shape); the request
  may pass `provider` explicitly to override for self-hosted GitLab.
- `create_github_issue` / `create_gitlab_issue` create the issue with the task's
  title, description, plain labels (decision/enhanced labels excluded, matching
  the inbound label rule), and assignee. On success the task's `external_*`
  fields are set, so all later two-way sync flows through the existing paths
  with no special casing.
- Preconditions fail loudly with actionable messages: 409 if already linked,
  400 for a missing integration token or repo URL, 502 if the upstream call
  fails. The action is logged as `task.issue_created`.
- Frontend: a per-row action creates the issue when unlinked, and a jump-off
  link opens the issue once linked (content stays external, per ADR-0017).

## Consequences
Positive:
- Closes the outbound-create gap: a Shard-first task can now seed an external
  issue and immediately participate in existing two-way sync.
- No new stored state — reuses `projects.repo_url`, the issue_sync integration
  token, and the task's `external_*` columns.
- One GitHub-compatible path serves github.com, GHE, and Gitea.

Negative:
- Provider detection is heuristic for self-hosted GitLab on a non-obvious host;
  such setups must pass `provider` explicitly.
- The action creates a fresh issue every call; it does not attempt to find or
  de-duplicate an existing matching issue. The 409-on-already-linked guard is
  the only safety against double-creation, and it only sees Shard's own link.
- Milestone/cycle and due-date fields are not sent at creation time; those
  remain separate sync concerns.
