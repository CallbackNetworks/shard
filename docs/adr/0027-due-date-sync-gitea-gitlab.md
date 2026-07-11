# ADR-0027: Due-Date Sync for Gitea and GitLab

## Status
Accepted

## Date
2026-07-11

## Context
Field sync (ADR-0015) pushes title, description, and assignee between Shard
tasks and linked issues, but not due dates — even though Shard tasks and both
Gitea and GitLab issues all have one. The obstacle is capability asymmetry:
github.com and GitHub Enterprise issues have no due-date concept at all, while
Gitea (github-compatible API) and GitLab do. A naive "add due_date to the field
payload" would send an unknown field to github.com and risk a 422 that fails the
whole update.

The provider split does not map cleanly to Shard's stored `external_provider`:
`github` covers github.com, GHE, and Gitea alike. Gitea can only be
distinguished at sync time by its resolved API base being something other than
`https://api.github.com` (ADR-0010's base resolution).

## Decision
Sync due dates bidirectionally for Gitea and GitLab only; never touch a due date
on github.com / GHE.

- **Inbound:** `parse_due_date` normalizes both formats — GitLab's plain
  `YYYY-MM-DD` and Gitea's RFC3339 — into an aware datetime. The issue
  normalizers carry a `due_date` key (github.com payloads simply lack the field,
  yielding None), and the webhook handler applies it on task create and update.
- **Outbound:** in `sync_task_fields_to_external`, GitLab receives `due_date` in
  the normal field PUT (plain date; empty string clears). For github-compatible
  hosts, due_date is sent only when the resolved base is not `api.github.com`,
  and as its own request so a non-Gitea host that rejects the field cannot fail
  the title/description update. `format_due_date_gitea` / `format_due_date_gitlab`
  own the per-provider formatting.

## Consequences
Positive:
- Due dates now round-trip for the two providers that support them, completing
  field parity for those hosts.
- github.com / GHE are never sent an unsupported field, and the separate Gitea
  request isolates due-date failures from the rest of field sync.
- Reuses the existing field-sync trigger in the task update handler; the only
  new wiring is a `due_date` change check.

Negative:
- Gitea is detected heuristically (API base ≠ api.github.com). A GitHub
  Enterprise instance on a custom host also matches, so a best-effort due_date
  request is made and silently fails there — harmless but wasted.
- Clearing a due date (setting it to null) does not sync outbound: the task
  update handler drops null fields (`exclude_none=True`), so only setting or
  changing a date propagates. This matches the existing assignee-clear behavior
  and is left as-is rather than reworking the update contract.
- Due date is not sent when first creating an external issue (ADR-0026); it
  propagates on the next task edit.
