# ADR-0149: Recurring work is scheduled here and run there

## Status
Accepted

## Date
2026-09-04

## Context

The question is how one agent gives another agent work that repeats — a nightly check,
a weekly report, a "look at this every Monday" — when both of them reach Shard through
`/api/v1` or MCP and neither of them is running when the work comes due. Put as a design
question: **should Shard grow a cron, or does the cron belong on the agent's side?**

It is worth writing down because Shard contains five things that look like an answer and
are not, and working out which is which took a whole conversation. Anyone arriving at this
codebase will start from the same wrong place.

**The rules engine looks like the answer and cannot be.** It reacts to anything that
happens in the graph, with conditions that can read the change itself
([ADR-0049](0049-rules-trigger-on-nodes-not-tasks.md),
[ADR-0055](0055-rules-trigger-on-graph-change-not-only-creation.md)). But every one of its
five triggers is reactive:

    node.created   node.updated   node.deleted   edge.added   edge.removed

Each requires that somebody else wrote something first. There is no trigger that fires
because time passed, so no rule can say "every Monday". The engine can respond to any
change in the graph and cannot respond to the clock. This is the gap people notice, and
noticing it leads directly to the proposal this ADR declines.

**The scheduler looks like the answer and is the wrong layer.** `services/scheduler.py` is
an asyncio loop inside the API process, ticking hourly through seven checks. It sends
reminders, retries webhooks, mails digests and writes backups. It is a good place to put
"Shard does something on a timer" and it has no way to start an agent, no business
acquiring one, and one process-global heartbeat shared by all seven checks.

**`RecurrenceRule` is closest, and it is welded to a single action.** It is a real
user-definable timer — `frequency` (daily/weekly/monthly/interval), `interval_value`,
`next_run_at`, `last_run_at`, `end_date`, `active` — reachable by agents through
`/api/v1/projects/{id}/tasks/{task_id}/recurrence` ([ADR-0086](0086-a-field-you-can-read-is-a-field-you-can-write.md))
and the `manage_recurrence` MCP tool ([ADR-0093](0093-the-mcp-registry-catches-up-with-the-api.md)).
But `template_task_id` is `unique=True` and NOT NULL, so it does not model "a timer". It
models "this task repeats", one rule per task, whose only effect is to clone that task.

**Agent-level assignment already exists and is easy to miss.** A task carries `assignee`
(free text, for people) *and* `assigned_agent_key_id`, which names an actual `ApiKey` and is
validated against a live one on write. So a task can already be addressed to a specific
agent rather than to whoever looks next.

**The outbound half already exists too.** `fire_notifications` sends HMAC-signed webhooks
with a delivery log and `[1, 5, 30, 120, 360]`-minute retry backoff
([ADR-0060](0060-a-callback-is-signed-or-it-is-not-accepted.md),
[ADR-0063](0063-an-integrations-configuration-is-credentials.md)). "Something happened,
go wake up" is a solved problem here.

So the pieces of an answer were all present, and what was missing was the statement of
where the boundary runs — plus one line of code, see below.

## Decision

**The definition of recurring work lives in Shard. The execution of it does not.**

The boundary is *who presses the button*, and each half sits where it does for a reason
the other cannot satisfy:

- **The schedule is data, and it belongs here.** The premise of the question is that
  agents assign it *to each other*: agent A must be able to see, change and revoke the
  recurring work agent B does. A crontab on B's machine cannot be read by A, so a schedule
  stored there is not an assignment — it is B configuring itself. Only a shared object
  behind both API doors ([ADR-0092](0092-work-gets-in-and-out-through-both-doors.md)) can
  be assigned, and Shard is already the durable, queryable, activity-logged place such
  objects live.

- **Running the work belongs to the agent side, and Shard must not acquire the ability.**
  Shard cannot start an agent, and should not learn how. Making a task manager depend on an
  LLM runtime in order to keep its own schedules would invert the thing that has been
  bought one ADR at a time — that this installs and runs on its own
  ([ADR-0139](0139-the-self-host-stack-keeps-its-data-in-a-volume.md),
  [ADR-0140](0140-an-upgrade-stops-first-and-keeps-what-it-replaces.md)). It is also the
  ADR-0141 answer again, in a different costume: the extension point is declared data, not
  code we host and run ([ADR-0141](0141-extension-is-declared-data-not-loaded-code.md)).

**The supported path is therefore the one already built**, and it is three existing parts
rather than a new mechanism:

1. A recurring task, created through `manage_recurrence` or the `/recurrence` routes, with
   `assigned_agent_key_id` naming the agent that is to do it.
2. The scheduler generates a fresh copy when `next_run_at` comes round, through the normal
   task pipeline — so rules, notifications and the WebSocket broadcast all run
   ([ADR-0048](0048-rule-actions-through-the-pipeline-and-event-subscription.md)).
3. `task.created` fires an outbound webhook to whatever the operator runs, which starts the
   agent. The agent asks Shard what is assigned to it and does the work.

Two things are **deliberately not built**:

- **A time-based rules trigger** (`timer.fired`) that fans out onto a batch of task
  subjects and runs the built-in actions on each. That design answers a real but *different*
  question — automating Shard's own data, "every morning raise overdue cards to high" — and
  applying it here would be a category error: expanding a timer into task subjects and
  running `set_status` on them has nothing to do with waking an agent. It also brings a
  fan-out cost (one timer matching 300 cards writes 300 rule executions per tick into the
  activity log, which `trigger_rules=False` does not bound because it only stops chaining).
  If the data-automation need arrives on its own, that is its own ADR.

- **A claim/lease mechanism.** The obvious objection to agents sharing a queue is that two
  of them grab the same item. It does not apply, because there is no queue: work is
  addressed to a specific key at the moment it is created, so there are no unowned cards to
  race for. The residual case is one agent woken twice for the same card — a retried webhook
  delivery, say — where two sessions hold the same key and a lease could not tell them
  apart either. Repeating most of this work is harmless; where it is not, idempotence
  belongs in the action that has the side effect, not in Shard.

**One defect fell out of writing this down**, and it is the reason the path above needs a
test rather than only a paragraph. The scheduler's clone copied `assignee` and not
`assigned_agent_key_id`. A schedule aimed at an agent therefore produced work aimed at
nobody: every generated copy arrived with no agent while the template still named one — the
exact unowned card this design says cannot exist. Because the free-text half kept working,
nothing about the template ever looked wrong. The copy now carries the assignment, and a key
that has been revoked since the rule was written is dropped with a warning rather than
copied forward, since an id pointing at nothing renders as an assignment on every surface
that shows one.

## Consequences

Recurring agent work is available now, with no new mechanism and no new table — the parts
were already shipped and only their combination was undocumented. `docs/agent-guide.md`
carries the recipe, so the next agent to ask finds it in the document it already reads.

The boundary is a real constraint, and it points outward. Shard will not gain "run this
command on a schedule", and an operator wanting recurring agent work must run something
that receives a webhook. That is a genuine cost for a self-hoster who wanted the whole
thing in one box, and it is the deliberate price of the box staying installable without an
agent runtime in it.

An agent cannot ask the server what is assigned to it. `assigned_agent_key_id` is writable
and readable on every task and is not a filter on any listing endpoint, so an agent that
polls must list and check the field itself. The webhook names the task, so the normal path
does not need the query — this is a limitation of the fallback, and it is the same shape as
[ADR-0086](0086-a-field-you-can-read-is-a-field-you-can-write.md): a field you can write and
cannot select by.

Schedules cannot be inspected as a group. There is no "list every recurring thing" view —
a rule hangs off its template task and is found through that task. This is tolerable while
the number is small and is the first thing to revisit if it is not.

The generated copy carries title, description, priority, assignee and now the agent key.
It does not carry labels, due date or estimate. That is unchanged by this ADR and not
asserted to be right; it is simply not what was being decided.

**What would reopen this.** Two observations, either alone: recurring work that should
leave nothing behind when it finds nothing wrong (an hourly "is CI red?" that generates 24
cards a day is the wrong shape, and wants a timer that fires an event rather than one that
creates a task); or the same work genuinely being executed twice with consequences, which
would make the claim above about idempotence wrong rather than merely untested.
