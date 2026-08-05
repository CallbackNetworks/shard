"""What of a node's ``data`` blob may leave the server (ADR-0059).

``Node.data`` is free-form JSON. That is what makes the single node write surface
(ADR-0040→0043) work for user-defined types — and it is also why nothing ever reviewed
what ends up inside it. Secrets do: a share token, a share PIN hash, a CI callback token,
a webhook signing secret. Because the blob has no schema, none of them appear in the
OpenAPI contract, and a reader auditing the API would never see them.

Before this module every read handed the whole blob over, so a ``read``-scope API key —
the least privilege the system offers — could list nodes and collect every callback token
in the database. ``/webhook/callback/{token}`` is deliberately unauthenticated, and its
signature check is skipped when a task has no ``webhook_secret``, so that collection was a
working write path. A read key could change task state.

The bespoke identity router already knew better: it has always projected the PIN hash down
to a boolean ``share_pin_set``. That knowledge simply did not survive the collapse onto a
generic node surface, which is the same shape of defect this codebase keeps finding — a
rule that lived in one hand-written place and did not generalise when the surface did.
So it lives here now, in one place, applied on the way out.
"""

# Credentials at rest, which no node or task payload has a reason to carry. A PIN hash is
# a salted single-round SHA-256 of a short numeric PIN, which is to say it is the PIN; a
# webhook secret is a signing key. Reading a payload should say whether one is set, no
# more. The secret does have to reach whoever configures CI — it is mandatory since
# ADR-0060 — but through one deliberate, logged request (``GET /api/nodes/{id}/webhook``)
# rather than riding along in every list response a session happens to fetch.
NEVER_SERVED = ("share_pin_hash", "webhook_secret")

# Capabilities rather than credentials: holding one lets you act. The share token *is* the
# public URL, and the callback token *is* the authority to post a build result. The owner's
# own session and an ``admin`` key get them; lower scopes do not, so listing nodes stops
# being a way to accumulate authority you were not granted.
TOKENS = ("share_token", "callback_token")

# Derived on read, never stored. Stripped on the way in so a client that PATCHes back a
# node it just read cannot persist it as a junk key.
DERIVED = ("share_pin_set",)


def public_data(data: dict | None, *, reveal_tokens: bool = True) -> dict | None:
    """The servable view of a node's ``data``.

    ``reveal_tokens`` is the caller's authority, not a property of the node: the same node
    reads differently for the owner's session and for a read-only agent key.
    """
    if not data:
        return data
    hidden = set(NEVER_SERVED) if reveal_tokens else set(NEVER_SERVED) | set(TOKENS)
    out = {k: v for k, v in data.items() if k not in hidden}
    if "share_pin_hash" in data:
        out["share_pin_set"] = bool(data["share_pin_hash"])
    return out


def strip_derived(data: dict | None) -> dict | None:
    """Drop read-only projections from data on its way in."""
    if not data:
        return data
    return {k: v for k, v in data.items() if k not in DERIVED}


def strip_tokens(payload):
    """Remove token keys from an already-serialised response, at any depth.

    Used by the v1 redaction middleware. Walking the finished JSON rather than threading a
    flag through every endpoint is the whole point: ``/api/v1`` has a dozen response shapes
    and will grow more, and a rule enforced per-endpoint is a rule a new endpoint can be
    written without. The invariant is about the response, so it is checked on the response.
    """
    if isinstance(payload, dict):
        return {k: strip_tokens(v) for k, v in payload.items() if k not in TOKENS}
    if isinstance(payload, list):
        return [strip_tokens(item) for item in payload]
    return payload
