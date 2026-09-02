# ADR-0141: Extension is declared data, not loaded code

## Status
Accepted

## Date
2026-09-01

## Context

The question was whether Shard should grow a plugin mechanism — a way for code
somebody else wrote to be loaded into the running application and extend it.

It is worth asking because the product genuinely is extensible, and has been made so
deliberately, one ADR at a time. What is easy to miss is that all of that extensibility
was built as *data* rather than as *code*, and that this was not an accident of
implementation but the recurring answer to a recurring question:

- **What shapes exist** is a row. `node_types` and `edge_types` are a registry
  ([ADR-0033](0033-graph-foundation-final-shape.md), [ADR-0074](0074-a-type-declares-which-fields-are-the-users.md),
  [ADR-0078](0078-a-relation-declares-what-may-sit-at-each-end.md)) writable through both API doors
  ([ADR-0079](0079-a-layer-can-be-created-through-the-api.md),
  [ADR-0132](0132-a-field-declaration-can-be-declared.md)). A new layer, a new relation
  with its own endpoint rules, a new field with its own widget: none of it is a code
  change. This instance is already running three custom types nobody wrote code for.
- **What happens when something changes** is a row. The rules engine
  ([ADR-0049](0049-rules-trigger-on-nodes-not-tasks.md),
  [ADR-0055](0055-rules-trigger-on-graph-change-not-only-creation.md)) hooks five graph-shaped triggers
  with conditions that can read the change itself, and its `fire_event` action reaches
  the integration layer.
- **How the outside world joins in** is configuration. Outbound: HMAC-signed webhooks
  and email integrations ([ADR-0060](0060-a-callback-is-signed-or-it-is-not-accepted.md),
  [ADR-0063](0063-an-integrations-configuration-is-credentials.md)). Inbound: 117 `/api/v1`
  routes and 51 MCP tools, with a sweep whose explicit rule is that no capability is
  browser-only ([ADR-0085](0085-a-capability-is-not-browser-only.md),
  [ADR-0091](0091-configuring-the-instance-is-not-a-browser-only-act.md),
  [ADR-0092](0092-work-gets-in-and-out-through-both-doors.md)).

So the honest form of the question is not "should this be extensible" — it is — but
"what does loading foreign code into this process buy that those three do not already
provide, and what does it cost?"

The costs are not hypothetical here, because this codebase has already paid most of
them once and written down the receipts.

**It is a second write surface by construction.** [ADR-0040](0040-single-graph-write-surface-and-node-roles.md)
→ [ADR-0043](0043-collapse-container-scoped-writes-to-nodes.md) spent four decisions collapsing every
entity's writes onto one dispatcher, and
[ADR-0070](0070-one-share-panel-for-every-shareable-node.md)→[ADR-0073](0073-a-project-is-shared-like-everything-else.md),
[ADR-0087](0087-the-last-duplicate-share-implementation.md) and [ADR-0089](0089-one-assistant-one-definition-of-overdue.md)
are each a bill for a duplicate that had been quietly drifting. A plugin API is an
invitation to write the second implementation, held by someone who cannot be made to
collapse it.

**It crosses the credential boundary.** [ADR-0059](0059-credentials-do-not-leave-the-server.md),
[ADR-0063](0063-an-integrations-configuration-is-credentials.md) and
[ADR-0085](0085-a-capability-is-not-browser-only.md) rest on the claim that a secret does
not leave the server. In-process code holds the session and the raw `Node.data`; it is
inside the boundary those ADRs draw, and their guarantee becomes "for code we shipped",
which is a different and much weaker sentence.

**It contradicts the current line of work.** [ADR-0135](0135-the-pipeline-runs-on-somebody-elses-machine-too.md)
→ [ADR-0140](0140-an-upgrade-stops-first-and-keeps-what-it-replaces.md) drove the install
down to one command and gave it an upgrade path. A plugin host adds a compatibility
matrix, a "this plugin needs 1.1" failure mode, and a class of bug report where the
first question is which foreign code was loaded.

**The population it serves is empty.** A plugin mechanism earns its cost when other
people write the plugins. This is a personal, single-user tool; for its one user,
editing the repository is strictly faster than writing against a plugin API and
versioning it.

There is one thing the existing three genuinely cannot do, and it should be stated
rather than glossed: **they are all after-the-fact.** `fire_event` is asynchronous and
its listener cannot refuse the write that triggered it. Nothing today can say "reject
this mutation" or "rewrite this value before it is stored" from outside the codebase.

## Decision

**No plugin mechanism.** Extension stays declared data — node and edge types, workflow
rules, and the two API doors — and the process loads only code from this repository.

This is a decision to be revisited, not a permanent closure, and the trigger is written
down so it can be recognised rather than argued: **a third distinct need that must
intervene synchronously in a write, and that cannot be expressed as a type declaration
plus a rule.** Two such needs are a coincidence; three is a shape.

When that trigger fires, the first thing to build is still not code loading. It is a
synchronous outbound hook — a rules-engine action, or a pre-write callback URL — that
sends the pending change to an address the user configures and honours the answer. That
keeps the process boundary, keeps the credential rule intact, needs no versioning story,
and costs roughly a tenth of a plugin host. Code loading would only be reconsidered if
that hook proved insufficient in practice, which is a much later question.

## Consequences

**Positive.** The single write surface, the credential boundary and the one-command
install all keep their current strength, and none of them acquires an asterisk about
foreign code. The extension points that do exist stay the obvious place to look,
instead of competing with a more powerful mechanism that would make them look vestigial.

**Positive.** The revisit condition is a concrete observation rather than a feeling, so
the question does not have to be re-argued from scratch each time it comes up. This
document is the answer to "why is there no plugin system?", which is exactly the
question a future maintainer would otherwise ask with nothing to read.

**Negative.** Synchronous interception is genuinely unavailable, and no amount of type
declarations or rules provides it. Anyone wanting to veto or rewrite a write from
outside has no answer today, and the honest response is that this is not yet a need this
instance has demonstrated — not that it is impossible.

**Negative.** Adding a capability the registry cannot express still means a commit, a
CI run and a deploy. For the current single maintainer that is cheaper than the
alternative; it would stop being cheaper the moment a second party wants to extend the
tool without write access to the repository, and that change in population — not any
technical argument — is what would most plausibly overturn this.

**Negative.** "Extensible" now means something narrower than a reader may assume from
the word, and the README and agent-facing docs describe the registry and the API rather
than announcing what is absent. Someone evaluating the project against tools that
advertise plugins will not find this document unless they look in `docs/adr/`.
