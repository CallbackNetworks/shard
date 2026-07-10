"""add guest notes support (comments.guest_name, nullable task_id, allow_guest_notes flags)

Revision ID: c7d9e1f3a5b7
Revises: a1b3c5d7e9f0
Create Date: 2026-07-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "c7d9e1f3a5b7"
down_revision: Union[str, None] = "a1b3c5d7e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    comment_cols = {c["name"]: c for c in inspector.get_columns("comments")}
    with op.batch_alter_table("comments", schema=None) as batch_op:
        if "guest_name" not in comment_cols:
            batch_op.add_column(sa.Column("guest_name", sa.String(length=80), nullable=True))
        if not comment_cols["task_id"]["nullable"]:
            batch_op.alter_column("task_id", existing_type=sa.String(length=36), nullable=True)

    identity_cols = {c["name"] for c in inspector.get_columns("identities")}
    if "allow_guest_notes" not in identity_cols:
        with op.batch_alter_table("identities", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("allow_guest_notes", sa.Boolean(), nullable=False, server_default=sa.false())
            )

    project_cols = {c["name"] for c in inspector.get_columns("projects")}
    if "allow_guest_notes" not in project_cols:
        with op.batch_alter_table("projects", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column("allow_guest_notes", sa.Boolean(), nullable=False, server_default=sa.false())
            )


def downgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("allow_guest_notes")
    with op.batch_alter_table("identities", schema=None) as batch_op:
        batch_op.drop_column("allow_guest_notes")
    op.execute("DELETE FROM comments WHERE task_id IS NULL")
    with op.batch_alter_table("comments", schema=None) as batch_op:
        batch_op.alter_column("task_id", existing_type=sa.String(length=36), nullable=False)
        batch_op.drop_column("guest_name")
