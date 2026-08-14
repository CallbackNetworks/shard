"""a relation declares what may sit at each end; member_of becomes owns

ADR-0078. Three things at once, because they are one change:

1. ``edge_types`` gains ``description`` / ``allowed_source`` / ``allowed_target``, and
   the built-in declarations are backfilled — ``seed_builtin_types`` only inserts
   *missing* types, so a change to a built-in declaration reaches an existing database
   only through a revision like this one (same shape as a1c3e5b7d9f0).
2. ``member_of`` -> ``owns``: the old name read backwards (source is the identity, so it
   parsed as "identity is a member of the project" while the system means the identity
   owns it). Renames the registry row and every existing edge.
3. ``assigned_to`` is deleted — declared, never written by any code path, zero rows.
   Deleted only when that is still true, so a database that somehow has such edges keeps
   them rather than losing data to a migration.

Revision ID: b2d4f6a8c1e3
Revises: a1c3e5b7d9f0
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c1e3"
down_revision: str | None = "a1c3e5b7d9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EDGE_TYPES = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("description", sa.Text),
    sa.column("allowed_source", sa.JSON),
    sa.column("allowed_target", sa.JSON),
)
_EDGES = sa.table("edges", sa.column("rel_type", sa.String))


def upgrade() -> None:
    from app.services.graph_registry import BUILTIN_EDGE_TYPES

    with op.batch_alter_table("edge_types") as batch:
        batch.add_column(sa.Column("description", sa.Text(), nullable=True))
        batch.add_column(sa.Column("allowed_source", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("allowed_target", sa.JSON(), nullable=True))

    conn = op.get_bind()

    # member_of -> owns. The registry row is renamed in place (the key is the PK and
    # edges.rel_type carries the string, not a foreign key).
    conn.execute(_EDGE_TYPES.update().where(_EDGE_TYPES.c.key == "member_of").values(key="owns", label="Owns"))
    conn.execute(_EDGES.update().where(_EDGES.c.rel_type == "member_of").values(rel_type="owns"))

    # Retire dead vocabulary, but never at the cost of data.
    in_use = conn.execute(
        sa.select(sa.func.count()).select_from(_EDGES).where(_EDGES.c.rel_type == "assigned_to")
    ).scalar()
    if not in_use:
        conn.execute(_EDGE_TYPES.delete().where(_EDGE_TYPES.c.key == "assigned_to"))

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
    conn = op.get_bind()
    conn.execute(_EDGES.update().where(_EDGES.c.rel_type == "owns").values(rel_type="member_of"))
    conn.execute(_EDGE_TYPES.update().where(_EDGE_TYPES.c.key == "owns").values(key="member_of", label="Member of"))
    with op.batch_alter_table("edge_types") as batch:
        batch.drop_column("allowed_target")
        batch.drop_column("allowed_source")
        batch.drop_column("description")
