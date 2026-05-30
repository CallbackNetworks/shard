"""add cicd integration enhancements

Revision ID: 6fcd6b8edc46
Revises: 925c7e57b28a
Create Date: 2026-05-30 07:36:31.597900

Adds:
- webhook_events table for build history
- tasks.webhook_secret column
- integrations.custom_headers, auth_type, auth_config, template_id columns
- integrations.type column widened to String(50) for new provider types
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6fcd6b8edc46'
down_revision: Union[str, None] = '925c7e57b28a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    """Check if a column already exists (for idempotent migration)."""
    from sqlalchemy import inspect as sa_inspect
    bind = op.get_bind()
    insp = sa_inspect(bind)
    cols = {c["name"] for c in insp.get_columns(table)}
    return column in cols


def _table_exists(table: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    bind = op.get_bind()
    insp = sa_inspect(bind)
    return table in insp.get_table_names()


def upgrade() -> None:
    # Create webhook_events table
    if not _table_exists("webhook_events"):
        op.create_table(
            "webhook_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("provider", sa.String(50), nullable=False, server_default="generic"),
            sa.Column("event_type", sa.String(100), nullable=True),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("commit_sha", sa.String(64), nullable=True),
            sa.Column("branch", sa.String(255), nullable=True),
            sa.Column("build_url", sa.String(2048), nullable=True),
            sa.Column("build_number", sa.String(100), nullable=True),
            sa.Column("build_duration_ms", sa.Integer(), nullable=True),
            sa.Column("triggered_by", sa.String(255), nullable=True),
            sa.Column("test_summary", sa.JSON(), nullable=True),
            sa.Column("raw_payload", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )

    # Widen integrations.type column
    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.alter_column('type',
               existing_type=sa.VARCHAR(length=7),
               type_=sa.String(length=50),
               existing_nullable=False)

    # Add new columns (idempotent - lifespan may have already added them)
    if not _column_exists("tasks", "webhook_secret"):
        with op.batch_alter_table("tasks") as batch_op:
            batch_op.add_column(sa.Column("webhook_secret", sa.String(128), nullable=True))

    if not _column_exists("integrations", "custom_headers"):
        with op.batch_alter_table("integrations") as batch_op:
            batch_op.add_column(sa.Column("custom_headers", sa.JSON(), nullable=True))

    if not _column_exists("integrations", "auth_type"):
        with op.batch_alter_table("integrations") as batch_op:
            batch_op.add_column(sa.Column("auth_type", sa.String(20), nullable=True, server_default="bearer"))

    if not _column_exists("integrations", "auth_config"):
        with op.batch_alter_table("integrations") as batch_op:
            batch_op.add_column(sa.Column("auth_config", sa.JSON(), nullable=True))

    if not _column_exists("integrations", "template_id"):
        with op.batch_alter_table("integrations") as batch_op:
            batch_op.add_column(sa.Column("template_id", sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.alter_column('type',
               existing_type=sa.String(length=50),
               type_=sa.VARCHAR(length=7),
               existing_nullable=False)
        batch_op.drop_column("custom_headers")
        batch_op.drop_column("auth_type")
        batch_op.drop_column("auth_config")
        batch_op.drop_column("template_id")

    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("webhook_secret")

    op.drop_table("webhook_events")
