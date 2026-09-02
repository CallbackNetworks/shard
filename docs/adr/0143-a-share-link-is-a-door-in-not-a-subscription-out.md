# ADR-0143: A share link is a door in, not a subscription out

## Status
Accepted

## Date
2026-09-02

## Context

The question was whether the public share page should let the people reading it
register a webhook — an address of their choosing that this server would POST to when
the shared work changes.

It is a reasonable thing to ask for. Somebody outside the instance is following a
project through a link, and "tell me when something happens" is what they actually
want. The app also already has every piece such a feature would need: outbound
delivery with HMAC signatures, a retry schedule, a per-attempt delivery log
([ADR-0060](0060-a-callback-is-signed-or-it-is-not-accepted.md),
[ADR-0063](0063-an-integrations-configuration-is-credentials.md),
[ADR-0085](0085-a-capability-is-not-browser-only.md)). Adding a registration form to
the share page looks like wiring, not construction.

The public surface as it stands is five routes, and its security model is that the
token in the URL *is* the credential ([ADR-0071](0071-one-public-door-and-it-cannot-be-the-page-itself.md),
[ADR-0072](0072-a-lock-that-can-be-set-is-a-lock-that-is-enforced.md),
[ADR-0073](0073-a-project-is-shared-like-everything-else.md)): read the page, verify a
PIN, leave a guest note, ask the read-only assistant a question
([ADR-0098](0098-the-public-assistant-only-knows-what-the-page-shows.md)), and subscribe to
the calendar feed at `/ical/node/{token}.ics`. Every one of those is a request the
visitor makes. Nothing on that list causes the server to originate traffic later, and
nothing on it stores an instruction from an anonymous party.

A viewer-registered webhook would be the first of both, and that is the whole
difference. Four consequences follow, and none of them is about how hard the feature is
to build:

**The server would make requests to an address a stranger picked.** Whoever holds a
share link — which travels by forwarding, and is meant to — could point this instance
at an internal address and read the timing, or use it as a relay that carries this
host's identity. Every outbound target today is one the owner configured. This would be
the first that is not.

**There would be nothing to revoke.** An integration belongs to the owner: it is listed,
disabled and deleted from a page. A visitor subscription has no principal behind it, so
it needs its own registry, its own expiry, its own revocation UI, and its own answer to
what happens when the share token is rotated, the PIN changes or the share expires. That
is not wiring; it is a second subscription system whose subjects cannot be identified.

**The payload would be a second description of the shared work.** The read path holds a
line that has been worth keeping: what the share assistant may know is exactly what the
page shows, because [ADR-0098](0098-the-public-assistant-only-knows-what-the-page-shows.md)
hands it `get_share_node()`'s return value verbatim. A push payload cannot reuse that —
it describes a change, not a page — so it becomes a second serialisation of public data
that has to be kept in step with the first. That is the shape
[ADR-0070](0070-one-share-panel-for-every-shareable-node.md) and
[ADR-0087](0087-the-last-duplicate-share-implementation.md) each billed for, on the one
surface where drift is visible to people who are not the owner.

**The pull-shaped answer is already shipped.** `/ical/node/{token}.ics` is the same
token, read-only, stores nothing, and is revoked by rotating the token that was going to
be rotated anyway. For "an outsider wants to keep up with this project" it is the
existing answer, and it cost nothing to have.

## Decision

**No viewer-registered webhooks on the share page.** Outsiders subscribe by pulling —
the calendar feed — and push notification stays a thing the *owner* configures.

When a specific external party does need push, the owner adds an integration pointing at
their endpoint. It is signed, logged, disableable, and reachable from both API doors
already ([ADR-0085](0085-a-capability-is-not-browser-only.md)), so the capability exists;
what this decision refuses is letting the anonymous side of the link be the one who
creates it.

This also passes the test [ADR-0141](0141-extension-is-declared-data-not-loaded-code.md)
just wrote down for extension requests generally: the need is real, and it is already
expressible with what exists, so the answer is to point at the existing mechanism rather
than to add a second one with a weaker trust story.

## Consequences

**Positive.** The public surface keeps the property that makes it easy to reason about:
every route on it is a request a visitor makes, and none of them leaves behind an
instruction the server will act on later. There is no new registry, no new revocation
path, and no second serialisation of shared data.

**Positive.** Notifying an outside party is still possible on the day it is needed, by
the owner, through the integration layer — so this is a decision about *who* may create
the subscription, not about whether the product can do it.

**Negative.** The pull answer does not cover every shareable type. The calendar feed
resolves a share token only for types carrying the `subscribable` role, and `repository`
is shareable without it — so a shared repository has a page and no feed. That gap is
worth closing by granting the role, not by adding push.

**Negative.** A calendar feed is a poor substitute for an event. It carries dated work
and says nothing about a comment, a status change or a new decision record, and it is
polled on the reader's schedule rather than the writer's. Somebody who asked for a
webhook and is handed an `.ics` URL has been given something genuinely less than they
asked for, and telling them otherwise would be dishonest.

**Negative.** If several outside parties end up wanting push, the owner-configured route
scales badly: one integration each, all maintained by hand by the one person who did not
want the notifications. That is the observation that should reopen this — and the shape
to reach for then is an owner-*approved* subscription (the viewer asks, the owner
grants), which keeps the principal and the revocation story while removing the manual
step.
