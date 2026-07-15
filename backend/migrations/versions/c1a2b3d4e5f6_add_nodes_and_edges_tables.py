"""add nodes and edges tables for unified graph model

Revision ID: c1a2b3d4e5f6
Revises: b2d4f6a8c0e3
Create Date: 2026-07-15 00:00:00.000000

See ADR-0032. This migration only creates the graph tables; the backfill of
existing entities/relationships into them is a separate revision.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, None] = "b2d4f6a8c0e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())

    if "nodes" not in existing:
        op.create_table(
            "nodes",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("type", sa.String(length=20), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=20), nullable=True),
            sa.Column("priority", sa.String(length=20), nullable=True),
            sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_nodes_type", "nodes", ["type"], unique=False)
        op.create_index("ix_nodes_status", "nodes", ["status"], unique=False)
        op.create_index("ix_nodes_due_date", "nodes", ["due_date"], unique=False)

    if "edges" not in existing:
        op.create_table(
            "edges",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("source_id", sa.String(length=36), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("target_id", sa.String(length=36), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("rel_type", sa.String(length=30), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("source_id", "target_id", "rel_type", name="uq_edge"),
        )
        op.create_index("ix_edges_source_id", "edges", ["source_id"], unique=False)
        op.create_index("ix_edges_target_id", "edges", ["target_id"], unique=False)
        op.create_index("ix_edges_rel_type", "edges", ["rel_type"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_edges_rel_type", table_name="edges")
    op.drop_index("ix_edges_target_id", table_name="edges")
    op.drop_index("ix_edges_source_id", table_name="edges")
    op.drop_table("edges")
    op.drop_index("ix_nodes_due_date", table_name="nodes")
    op.drop_index("ix_nodes_status", table_name="nodes")
    op.drop_index("ix_nodes_type", table_name="nodes")
    op.drop_table("nodes")
