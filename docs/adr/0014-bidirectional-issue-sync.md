# ADR-0014: Bidirectional Issue Sync for Comments, Labels, and State

## Status
Accepted

## Date
2026-07-09

## Context
Issue sync (ADR-0010) was half-duplex: inbound webhooks mirrored issue
title/description/status onto tasks, but outbound only covered one transition
(task done → close issue). Comments and labels were captured in the webhook
payload yet discarded, and reopening a done task left the external issue
closed. Working from Shard therefore still required switching to Gitea/GitHub
for discussion and labeling.

Extending sync raises two design problems:

1. **Echo loops.** Every outbound API write fires a webhook back at Shard
   (Gitea/GitHub emit events for API-driven changes). Without a dedupe
   mechanism, a comment posted from Shard would be re-imported as a new
   comment, then possibly re-pushed, looping forever.
2. **Conflicting label sources.** Shard labels double as decision records
   (ADR-0004), and label sets can be edited on both sides between webhooks.

## Decision
Extend sync to full duplex for state, comments, and labels:

- **State**: `sync_task_reopen_to_external` complements the existing closure
  sync — leaving `done` reopens the external issue (`state=open` on
  GitHub-compatible APIs, `state_event=reopen` on GitLab). Status echoes are
  inherently idempotent (setting the same state again is a no-op).
- **Comments**: a nullable indexed `comments.external_id` column stores the
  provider-side comment/note id. Inbound `issue_comment` / Note Hook events
  create, edit, or delete the matching Shard comment. Outbound, comment
  create/edit/delete on an externally linked task calls the provider API; the
  id returned by the create call is stored on the Shard comment. Echo
  prevention: an inbound `created` event whose `external_id` already exists is
  ignored — it is the webhook echo of our own outbound post.
- **Labels**: inbound issue events mirror the external label set onto the task
  (missing labels are auto-created with `source="issue_sync"`); outbound, any
  task-label attach/detach replaces the full external label set
  (`PUT .../issues/{n}/labels`). Only plain labels (`type == "label"`) take
  part — decision labels (ADR-0004) are never attached, detached, or pushed.
  Label mirroring is convergent rather than loop-prone because inbound apply
  never triggers an outbound push.

The inbound webhook handler writes directly to the DB (never through the
routers that trigger outbound sync), which structurally guarantees inbound
events cannot fan back out.

## Consequences
Positive: issue discussion, labeling, and the full open/close lifecycle can be
driven from either side. All calls reuse the existing `issue_sync` integration
token and ADR-0010 API-base resolution, so Gitea works with zero extra
configuration. No polling — everything stays webhook-driven.

Negative: there is a small race window where the webhook echo of an outbound
comment arrives before the external id is committed, which would duplicate the
comment; accepted for a single-user deployment. The external side is the label
source of truth on every inbound event, so a local label change that failed to
push outbound will be reverted by the next webhook. Gitea label replacement by
name requires Gitea >= 1.20. Comment authorship is not preserved outbound —
comments post as the token's user (author name only survives inbound).
