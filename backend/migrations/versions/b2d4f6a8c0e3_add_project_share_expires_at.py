"""add project share_expires_at

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5f7b9d2
Create Date: 2026-07-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e3"
down_revision: Union[str, None] = "a1c3e5f7b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c["name"] for c in inspector.get_columns("projects")]

    if "share_expires_at" not in cols:
        with op.batch_alter_table("projects", schema=None) as batch_op:
            batch_op.add_column(sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("share_expires_at")
