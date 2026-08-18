"""add share_chat_logs table for the public read-only Q&A assistant (ADR-0098)

Revision ID: e42323f4f4ef
Revises: c3e5a7b9d1f4
Create Date: 2026-08-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e42323f4f4ef"
down_revision: Union[str, None] = "c3e5a7b9d1f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "share_chat_logs" in inspector.get_table_names():
        return

    op.create_table(
        "share_chat_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("node_id", sa.String(length=36), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("ip_hash", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_share_chat_logs_node_id", "share_chat_logs", ["node_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_share_chat_logs_node_id", table_name="share_chat_logs")
    op.drop_table("share_chat_logs")
