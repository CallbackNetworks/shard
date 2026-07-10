"""add task_pull_requests table for PR signal sync

Revision ID: a1b3c5d7e9f0
Revises: e2f4a6c8d0b1
Create Date: 2026-07-09 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "a1b3c5d7e9f0"
down_revision: Union[str, None] = "e2f4a6c8d0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "task_pull_requests" in inspector.get_table_names():
        return

    op.create_table(
        "task_pull_requests",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("task_id", sa.String(length=36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False, server_default="github"),
        sa.Column("repo", sa.String(length=500), nullable=False),
        sa.Column("pr_number", sa.String(length=20), nullable=False),
        sa.Column("pr_url", sa.String(length=2048), nullable=False),
        sa.Column("pr_title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("branch", sa.String(length=255), nullable=True),
        sa.Column("state", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("review_state", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("task_id", "repo", "pr_number", name="uq_task_pr"),
    )
    op.create_index("ix_task_pull_requests_task_id", "task_pull_requests", ["task_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_task_pull_requests_task_id", table_name="task_pull_requests")
    op.drop_table("task_pull_requests")
