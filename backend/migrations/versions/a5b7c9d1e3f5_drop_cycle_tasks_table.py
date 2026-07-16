"""drop cycle_tasks table — cycle membership is now in_cycle edges

Revision ID: a5b7c9d1e3f5
Revises: f4a6b8c0d2e4
Create Date: 2026-07-15 00:03:00.000000

See ADR-0032. Cycle membership moved from the cycle_tasks association table to
in_cycle edges. The backfill (d2e4f6a8c0b2) already copied every row into an
edge, so dropping the table loses no data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "a5b7c9d1e3f5"
down_revision: Union[str, None] = "f4a6b8c0d2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "cycle_tasks" in inspector.get_table_names():
        op.drop_table("cycle_tasks")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "cycle_tasks" not in inspector.get_table_names():
        op.create_table(
            "cycle_tasks",
            sa.Column(
                "cycle_id", sa.String(length=36), sa.ForeignKey("cycles.id", ondelete="CASCADE"), primary_key=True
            ),
            sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        )
