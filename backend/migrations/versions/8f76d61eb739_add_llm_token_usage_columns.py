"""add input_tokens/output_tokens to assistant_messages and share_chat_logs (ADR-0100)

Revision ID: 8f76d61eb739
Revises: e42323f4f4ef
Create Date: 2026-08-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "8f76d61eb739"
down_revision: Union[str, None] = "e42323f4f4ef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_column_if_missing(bind, table: str, column: sa.Column) -> None:
    inspector = inspect(bind)
    existing = {c["name"] for c in inspector.get_columns(table)}
    if column.name not in existing:
        with op.batch_alter_table(table) as batch_op:
            batch_op.add_column(column)


def upgrade() -> None:
    bind = op.get_bind()
    _add_column_if_missing(bind, "assistant_messages", sa.Column("input_tokens", sa.Integer(), nullable=True))
    _add_column_if_missing(bind, "assistant_messages", sa.Column("output_tokens", sa.Integer(), nullable=True))
    _add_column_if_missing(bind, "share_chat_logs", sa.Column("input_tokens", sa.Integer(), nullable=True))
    _add_column_if_missing(bind, "share_chat_logs", sa.Column("output_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("share_chat_logs") as batch_op:
        batch_op.drop_column("output_tokens")
        batch_op.drop_column("input_tokens")
    with op.batch_alter_table("assistant_messages") as batch_op:
        batch_op.drop_column("output_tokens")
        batch_op.drop_column("input_tokens")
