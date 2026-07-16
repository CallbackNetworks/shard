"""drop task_dependencies table — dependencies are now depends_on edges

Revision ID: e3f5a7b9c1d3
Revises: d2e4f6a8c0b2
Create Date: 2026-07-15 00:01:00.000000

See ADR-0032. Task dependencies moved from the task_dependencies association
table to depends_on edges in the graph. The backfill (d2e4f6a8c0b2) already
copied every row into an edge, so dropping the table loses no data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e3f5a7b9c1d3"
down_revision: Union[str, None] = "d2e4f6a8c0b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "task_dependencies" in inspector.get_table_names():
        op.drop_table("task_dependencies")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "task_dependencies" not in inspector.get_table_names():
        op.create_table(
            "task_dependencies",
            sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
            sa.Column(
                "depends_on_id",
                sa.String(length=36),
                sa.ForeignKey("tasks.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
