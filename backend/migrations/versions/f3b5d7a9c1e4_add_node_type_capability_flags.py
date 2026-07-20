"""add node-type capability flags is_shareable/is_subscribable (ADR-0039)

Revision ID: f3b5d7a9c1e4
Revises: e2f4a6b8c0d3
Create Date: 2026-07-20 00:00:00.000000

Cross-cutting capabilities become data-driven node-type flags rather than being
hardcoded to identity/project (ADR-0039). Two boolean columns are added to
``node_types`` and backfilled true for the built-in ``identity`` and ``project``
types, preserving the historical "only identity/project can share / expose iCal"
behaviour. All other existing types default false; user types opt in via the
flags. No node data moves — share_token/PIN/expiry already live in node.data.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3b5d7a9c1e4"
down_revision: str | None = "e2f4a6b8c0d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.add_column(
            sa.Column("is_shareable", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("is_subscribable", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    # Backfill the built-in types that historically owned these capabilities.
    node_types = sa.table(
        "node_types",
        sa.column("key", sa.String),
        sa.column("is_shareable", sa.Boolean),
        sa.column("is_subscribable", sa.Boolean),
    )
    op.execute(
        node_types.update()
        .where(node_types.c.key.in_(["identity", "project"]))
        .values(is_shareable=True, is_subscribable=True)
    )
    # Drop the server_default now that every row has an explicit value; the ORM
    # supplies the default on insert, matching is_container/is_task_like.
    with op.batch_alter_table("node_types") as batch:
        batch.alter_column("is_shareable", server_default=None)
        batch.alter_column("is_subscribable", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.drop_column("is_subscribable")
        batch.drop_column("is_shareable")
