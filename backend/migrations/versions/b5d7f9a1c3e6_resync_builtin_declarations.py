"""re-apply every built-in node and edge declaration from the registry

``seed_builtin_types`` only inserts *missing* types and never overwrites, so an existing
database keeps whatever declaration it was given the first time. Every change to a built-in
declaration therefore needs a revision like this one — a1c3e5b7d9f0, b2d4f6a8c1e3 and
f6b8d0c2e4a3 each shipped one, and ADR-0095 did not.

The consequence was live: production's ``contains`` description still read "an identity
cannot be a parent here", which ADR-0095 made false — identity holds the ``container`` role
there and ``identity -> project`` containment is what production's own hierarchy is built
from. That text is served to agents at ``GET /api/v1/edge-types`` and generated into
``agent-context``, so the vocabulary an agent reads was telling it the opposite of the rule
``graph.add_edge`` enforces. ADR-0078 exists because the description is the part that
actually teaches; a stale one is worse than none.

Scope is the *declarations*, not the presentation: edge ``description`` /
``allowed_source`` / ``allowed_target`` (ADR-0078) and node ``fields`` (ADR-0074), which is
exactly what b2d4f6a8c1e3 and f6b8d0c2e4a3 resynced. ``label`` / ``icon`` / ``color`` /
``roles`` are deliberately left alone: those are editable per ADR-0079 and overwriting them
would revert somebody's choice. Custom types are never touched in either direction.

Revision ID: b5d7f9a1c3e6
Revises: a3c5e7d9b1f4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5d7f9a1c3e6"
down_revision: str | None = "a3c5e7d9b1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NODE_TYPES = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
_EDGE_TYPES = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("description", sa.Text),
    sa.column("allowed_source", sa.JSON),
    sa.column("allowed_target", sa.JSON),
)


def upgrade() -> None:
    from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

    conn = op.get_bind()
    for spec in BUILTIN_NODE_TYPES:
        conn.execute(_NODE_TYPES.update().where(_NODE_TYPES.c.key == spec["key"]).values(fields=spec.get("fields")))
    for spec in BUILTIN_EDGE_TYPES:
        conn.execute(
            _EDGE_TYPES.update()
            .where(_EDGE_TYPES.c.key == spec["key"])
            .values(
                description=spec.get("description"),
                allowed_source=spec.get("allowed_source"),
                allowed_target=spec.get("allowed_target"),
            )
        )


def downgrade() -> None:
    # No-op by design, for the same reason f6b8d0c2e4a3's is: the declarations this
    # replaces are not recoverable from here, and re-staling them on the way down would
    # serve a false rule to agents rather than restore anything.
    pass
