"""add traversal role flags to node_types (ADR-0033 A5)

Revision ID: e5f7a9b1c3d4
Revises: d4e6f8a0b2c3
Create Date: 2026-07-16 00:20:00.000000

Data-drives the leaf helpers that previously hardcoded ``n.type ==
NODE_TASK/PROJECT`` (see ADR-0033). Adds ``is_container`` / ``is_task_like`` to
node_types and seeds the built-in roles: project=container, task=task_like.
Idempotent.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e5f7a9b1c3d4"
down_revision: Union[str, None] = "d4e6f8a0b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("node_types")}
    with op.batch_alter_table("node_types") as batch:
        if "is_container" not in cols:
            batch.add_column(sa.Column("is_container", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if "is_task_like" not in cols:
            batch.add_column(sa.Column("is_task_like", sa.Boolean(), nullable=False, server_default=sa.text("0")))
    op.execute("UPDATE node_types SET is_container = 1 WHERE key = 'project'")
    op.execute("UPDATE node_types SET is_task_like = 1 WHERE key = 'task'")


def downgrade() -> None:
    with op.batch_alter_table("node_types") as batch:
        batch.drop_column("is_task_like")
        batch.drop_column("is_container")
