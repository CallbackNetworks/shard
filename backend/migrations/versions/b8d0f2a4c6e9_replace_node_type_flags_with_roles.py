"""replace node_type capability booleans with a roles set (ADR-0040)

Revision ID: b8d0f2a4c6e9
Revises: f3b5d7a9c1e4
Create Date: 2026-07-22 00:00:00.000000

The four capability booleans on ``node_types`` (is_container / is_task_like /
is_shareable / is_subscribable) collapse into a single ``roles`` JSON set
(ADR-0040): a type may carry several roles at once, and adding a future
capability is a new string in the set rather than a new column + migration.

Backfill maps each true boolean to its role noun (is_container -> "container",
is_task_like -> "task", is_shareable -> "shareable", is_subscribable ->
"subscribable"), then the booleans are dropped. render_as_batch keeps this
SQLite-safe. No node data moves.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d0f2a4c6e9"
down_revision: str | None = "f3b5d7a9c1e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (boolean column, role noun) in ADR-0040 order.
_FLAG_ROLES: list[tuple[str, str]] = [
    ("is_container", "container"),
    ("is_task_like", "task"),
    ("is_shareable", "shareable"),
    ("is_subscribable", "subscribable"),
]


def upgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.add_column(sa.Column("roles", sa.JSON(), nullable=True))

    node_types = sa.table(
        "node_types",
        sa.column("key", sa.String),
        sa.column("roles", sa.JSON),
        sa.column("is_container", sa.Boolean),
        sa.column("is_task_like", sa.Boolean),
        sa.column("is_shareable", sa.Boolean),
        sa.column("is_subscribable", sa.Boolean),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            node_types.c.key,
            node_types.c.is_container,
            node_types.c.is_task_like,
            node_types.c.is_shareable,
            node_types.c.is_subscribable,
        )
    ).all()
    for key, is_container, is_task_like, is_shareable, is_subscribable in rows:
        flags = {
            "is_container": is_container,
            "is_task_like": is_task_like,
            "is_shareable": is_shareable,
            "is_subscribable": is_subscribable,
        }
        roles = [role for col, role in _FLAG_ROLES if flags[col]]
        bind.execute(node_types.update().where(node_types.c.key == key).values(roles=roles or None))

    with op.batch_alter_table("node_types") as batch:
        batch.drop_column("is_subscribable")
        batch.drop_column("is_shareable")
        batch.drop_column("is_task_like")
        batch.drop_column("is_container")


def downgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        for col, _ in _FLAG_ROLES:
            batch.add_column(sa.Column(col, sa.Boolean(), nullable=False, server_default=sa.false()))

    node_types = sa.table(
        "node_types",
        sa.column("key", sa.String),
        sa.column("roles", sa.JSON),
        sa.column("is_container", sa.Boolean),
        sa.column("is_task_like", sa.Boolean),
        sa.column("is_shareable", sa.Boolean),
        sa.column("is_subscribable", sa.Boolean),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(node_types.c.key, node_types.c.roles)).all()
    for key, roles in rows:
        roles = roles or []
        bind.execute(
            node_types.update()
            .where(node_types.c.key == key)
            .values(**{col: (role in roles) for col, role in _FLAG_ROLES})
        )

    with op.batch_alter_table("node_types") as batch:
        for col, _ in _FLAG_ROLES:
            batch.alter_column(col, server_default=None)
        batch.drop_column("roles")
