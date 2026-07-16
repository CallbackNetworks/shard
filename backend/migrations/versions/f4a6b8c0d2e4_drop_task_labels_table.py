"""drop task_labels table — labels are now labeled edges

Revision ID: f4a6b8c0d2e4
Revises: e3f5a7b9c1d3
Create Date: 2026-07-15 00:02:00.000000

See ADR-0032. Task labels moved from the task_labels association table to
labeled edges in the graph. The backfill (d2e4f6a8c0b2) already copied every
row into an edge, so dropping the table loses no data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "f4a6b8c0d2e4"
down_revision: Union[str, None] = "e3f5a7b9c1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "task_labels" in inspector.get_table_names():
        op.drop_table("task_labels")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "task_labels" not in inspector.get_table_names():
        op.create_table(
            "task_labels",
            sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
            sa.Column(
                "label_id", sa.String(length=36), sa.ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True
            ),
        )
