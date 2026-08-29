"""A built-in declaration changed in code reaches an existing database only by revision.

``seed_builtin_types`` inserts *missing* types and never overwrites, which is right — a
user's own types and their edits are not the seed's to reset. The cost is that changing a
built-in's declaration in ``graph_registry`` updates fresh databases and no existing one,
so the same relation means different things depending on when the database was created.

That is not hypothetical and it is not cheap. ADR-0095 gave identity the ``container``
role and rewrote ``contains``'s description to say so, and shipped no backfill. Production
kept serving the old sentence — "an identity cannot be a parent here" — at
``GET /api/v1/edge-types`` and inside the generated ``agent-context``, for months, while
``graph.add_edge`` happily accepted exactly that edge and production's own hierarchy was
built from them. ADR-0078's whole argument is that the description is the part an agent
actually reads; a stale one teaches the opposite of the rule.

Three revisions before this one existed only to carry such a change across
(a1c3e5b7d9f0, b2d4f6a8c1e3, f6b8d0c2e4a3), and each was written because somebody
remembered. This fingerprint is what remembers instead: change a built-in declaration and
this test fails, and the way to make it pass is to ship the revision that carries the
change to databases that already exist.
"""

import hashlib
import json
import re
from pathlib import Path

from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations" / "versions"

# The declaration fields a revision has to carry. Not ``label``/``icon``/``color``/
# ``roles``: those are editable per ADR-0079, so resyncing them would revert a choice
# somebody made rather than correct a fact.
NODE_DECLARED = ("fields",)
# ``is_symmetric`` joined this list with ADR-0127: until ``conflicts_with`` nothing read
# it, so it was a comment shaped like a column. ``graph.add_edge``/``remove_edge`` read it
# now, which makes a stale copy of it a behaviour difference, not a wording one.
EDGE_DECLARED = ("description", "allowed_source", "allowed_target", "is_symmetric")

# Bump this together with a revision that re-applies the declarations to existing
# databases — see migrations/versions/b5d7f9a1c3e6_resync_builtin_declarations.py for the
# shape. Changing the fingerprint alone makes the test pass and leaves production stale,
# which is the failure this file exists to make impossible to reach by accident.
FINGERPRINT = "54675595aeea2578"
LAST_RESYNC_REVISION = "c6e8a0b2d4f7"


def _fingerprint() -> str:
    payload = {
        "nodes": {s["key"]: {f: s.get(f) for f in NODE_DECLARED} for s in BUILTIN_NODE_TYPES},
        "edges": {s["key"]: {f: s.get(f) for f in EDGE_DECLARED} for s in BUILTIN_EDGE_TYPES},
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def test_a_changed_builtin_declaration_ships_with_a_backfill():
    assert _fingerprint() == FINGERPRINT, (
        "A built-in node/edge declaration changed. `seed_builtin_types` only inserts "
        "missing types, so this change reaches fresh databases and no existing one — "
        "production included. Ship an Alembic revision that re-applies the declarations "
        f"(see {LAST_RESYNC_REVISION}), then update FINGERPRINT here to "
        f"{_fingerprint()!r} and LAST_RESYNC_REVISION to that revision."
    )


def test_the_named_resync_revision_exists_and_reapplies_both_registries():
    """A fingerprint pointing at a revision that does not do the work proves nothing."""
    matches = list(MIGRATIONS.glob(f"{LAST_RESYNC_REVISION}_*.py"))
    assert matches, f"no migration file for {LAST_RESYNC_REVISION}"
    source = matches[0].read_text()
    assert "BUILTIN_NODE_TYPES" in source and "BUILTIN_EDGE_TYPES" in source
    for field in NODE_DECLARED + EDGE_DECLARED:
        assert re.search(rf"\b{field}\b", source), f"{LAST_RESYNC_REVISION} does not re-apply {field!r}"
