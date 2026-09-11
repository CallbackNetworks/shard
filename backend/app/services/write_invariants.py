"""Rules a node write must satisfy, keyed by the type they are about (ADR-0161).

ADR-0159 closed a real hole — a decision's ``superseded`` status could be typed on
its own, with nothing naming the replacement — and closed it by adding a third branch
to ``assert_decision_write_shape``, a function named after one node type and called
*by that name* from the two generic write paths:

    graph.assert_decision_write_shape(db, node.type, changes, node_id=node.id)

That line is in ``graph_dispatch`` and ``node_admin``, which know nothing about
decisions and should not have to. The shape has a predictable end: the second type
needing an invariant gets a second hardcoded call beside the first, the third gets a
third, and the generic write surface — the thing ADR-0040→0043 spent four ADRs
collapsing into one — grows a per-type ``if`` ladder in everything but syntax. It is
also the reason ADR-0159 took as long to find as it did: three documents stated the
rule and none of them was anywhere a writer would look, because there was no *place*
for a write rule to live.

So invariants register themselves against the type they constrain, and the write paths
ask one question: "is this write allowed?" A module owning a type owns its rules and
declares them next to the code they are about.

**Registration is by type, and ``ANY`` is a real answer.** ADR-0130's guard fires on a
``label`` write carrying ``data.type="decision"`` — the whole point is that the write
*says* one type and *means* another, so keying it on the type in the payload would
register it under the one type it can never see. Rules that must inspect every write
register under ``ANY`` and decide for themselves.

A rule raises ``ServiceError`` (ADR-0085) and one handler renders it, so the internal
and v1 doors cannot refuse the same write differently — which is exactly what
``tests/test_agent_surface_parity.py`` asserts and what a rule written into a router
would break.
"""

from collections.abc import Callable
from typing import Final

from sqlalchemy.orm import Session

# The key a rule registers under when the write it inspects may claim any type.
ANY: Final = "*"

# ``(db, node_type, fields, node_id) -> None``; raises to refuse. ``node_id`` is None on
# create, which is itself information — a rule about what a row already *is* cannot hold
# for a row that does not exist yet.
Invariant = Callable[[Session, str, dict, str | None], None]

_RULES: dict[str, list[Invariant]] = {}


def register(node_type: str) -> Callable[[Invariant], Invariant]:
    """Declare an invariant for ``node_type`` (or :data:`ANY`), as a decorator."""

    def decorate(fn: Invariant) -> Invariant:
        _RULES.setdefault(node_type, []).append(fn)
        return fn

    return decorate


def check_write(db: Session, node_type: str, fields: dict | None, *, node_id: str | None = None) -> None:
    """Run every invariant that applies to this write. Raises on the first refusal.

    Called once on create and once on update, from the two services that own those
    acts. A write with no fields carries nothing to be wrong about.
    """
    if not fields:
        return
    for rule in (*_RULES.get(ANY, ()), *_RULES.get(node_type, ())):
        rule(db, node_type, fields, node_id)


def registered_types() -> dict[str, int]:
    """What is registered, for the guard test that pins the wiring."""
    return {key: len(rules) for key, rules in sorted(_RULES.items())}
