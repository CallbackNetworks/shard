"""add external_id to comments for issue comment sync

Revision ID: e2f4a6c8d0b1
Revises: b1c2d3e4f5a6
Create Date: 2026-07-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e2f4a6c8d0b1"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c["name"] for c in inspector.get_columns("comments")]

    if "external_id" not in cols:
        with op.batch_alter_table("comments", schema=None) as batch_op:
            batch_op.add_column(sa.Column("external_id", sa.String(length=100), nullable=True))

    indexes = {idx["name"] for idx in inspector.get_indexes("comments")}
    if "ix_comments_external_id" not in indexes:
        op.create_index("ix_comments_external_id", "comments", ["external_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_comments_external_id", table_name="comments")
    with op.batch_alter_table("comments", schema=None) as batch_op:
        batch_op.drop_column("external_id")
