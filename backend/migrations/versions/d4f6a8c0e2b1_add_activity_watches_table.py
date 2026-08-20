"""add activity_watches table for user-registered ticker curves (ADR-0105)

Revision ID: d4f6a8c0e2b1
Revises: 8f76d61eb739
Create Date: 2026-08-19 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "d4f6a8c0e2b1"
down_revision: Union[str, None] = "8f76d61eb739"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "activity_watches" in inspector.get_table_names():
        return

    op.create_table(
        "activity_watches",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=True),
        sa.Column("target_type", sa.String(length=30), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("activity_watches")
