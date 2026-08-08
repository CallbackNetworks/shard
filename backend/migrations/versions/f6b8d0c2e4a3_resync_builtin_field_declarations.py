"""re-apply the built-in field declarations

The declarations shipped in e5a7c9b1d3f2 had three faults, all fixed in
``graph_registry`` (ADR-0074): label's ``type``/``decision_status`` are closed sets and
belong in a picker rather than a text box, label's ``source`` records which surface
created the row and is not the user's to edit at all, and a project had no colour of its
own — the UI borrowed its first identity's, where "first" is edge-creation order.

Editing the seed is not enough on its own: ``seed_builtin_types`` only inserts *missing*
types and never overwrites, so an existing database keeps whatever it was given the first
time. Every change to a built-in declaration needs a revision like this one.

Revision ID: f6b8d0c2e4a3
Revises: e5a7c9b1d3f2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6b8d0c2e4a3"
down_revision: str | None = "e5a7c9b1d3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _apply_declarations() -> None:
    from app.services.graph_registry import BUILTIN_NODE_TYPES

    node_types = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
    conn = op.get_bind()
    for spec in BUILTIN_NODE_TYPES:
        conn.execute(
            node_types.update().where(node_types.c.key == spec["key"]).values(fields=spec.get("fields"))
        )


def upgrade() -> None:
    _apply_declarations()


def downgrade() -> None:
    # No-op by design: the previous declarations are not recoverable from here, and the
    # column itself is dropped one revision further down. A custom type's own
    # declarations are never touched by either direction.
    pass
