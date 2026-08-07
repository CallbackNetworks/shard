"""node types declare their editable data fields

A node's ``data`` is one bag holding three unrelated things: fields the user fills,
machinery a feature owns (share/callback tokens, sync bookkeeping), and whatever an
agent wrote once. Nothing described which was which, so no generic surface could offer
an editor and each built-in type grew a bespoke page instead. ``node_types.fields``
is that description (ADR-0074).

Backfilled here rather than left to ``seed_builtin_types``, which only inserts *missing*
types and never overwrites: every existing database already has its built-in rows, so
the seed would skip all of them and the column would stay empty everywhere but a fresh
install (the ADR-0064 lesson — a step that needs something else to happen is a step that
does not happen).

Revision ID: e5a7c9b1d3f2
Revises: d4f6a8c0e2b3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a7c9b1d3f2"
down_revision: str | None = "d4f6a8c0e2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.add_column(sa.Column("fields", sa.JSON(), nullable=True))

    # Imported rather than copied: graph_registry is the single definition of the
    # built-in set, precisely so a migration and the fresh-DB seed cannot drift.
    from app.services.graph_registry import BUILTIN_NODE_TYPES

    node_types = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
    conn = op.get_bind()
    for spec in BUILTIN_NODE_TYPES:
        fields = spec.get("fields")
        if not fields:
            continue
        conn.execute(node_types.update().where(node_types.c.key == spec["key"]).values(fields=fields))


def downgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.drop_column("fields")
