"""add node_types and edge_types registry tables (ADR-0033)

Revision ID: c3d5e7f9a1b2
Revises: d8e0f2a4b6c8
Create Date: 2026-07-16 00:00:00.000000

Data-drives the node-type and relationship vocabularies (see ADR-0033). Creates
two registry tables and seeds the built-in types so existing databases pick up
the same built-ins a fresh database gets from the startup seed. Idempotent.
"""

from datetime import UTC, datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "c3d5e7f9a1b2"
down_revision: Union[str, None] = "d8e0f2a4b6c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BUILTIN_NODE_TYPES = [
    ("project", "Project", "folder", "#818cf8"),
    ("task", "Task", "check-square", "#38bdf8"),
    ("identity", "Identity", "user", "#f472b6"),
    ("goal", "Goal", "target", "#34d399"),
    ("cycle", "Cycle", "repeat", "#fbbf24"),
    ("label", "Label", "tag", "#a78bfa"),
]

# (key, label, is_containment)
_BUILTIN_EDGE_TYPES = [
    ("contains", "Contains", 1),
    ("member_of", "Member of", 0),
    ("assigned_to", "Assigned to", 0),
    ("depends_on", "Depends on", 0),
    ("labeled", "Labeled", 0),
    ("in_cycle", "In cycle", 0),
    ("part_of", "Part of", 0),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())

    if "node_types" not in existing:
        op.create_table(
            "node_types",
            sa.Column("key", sa.String(length=30), primary_key=True),
            sa.Column("label", sa.String(length=80), nullable=False),
            sa.Column("icon", sa.String(length=40), nullable=True),
            sa.Column("color", sa.String(length=20), nullable=True),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "edge_types" not in existing:
        op.create_table(
            "edge_types",
            sa.Column("key", sa.String(length=30), primary_key=True),
            sa.Column("label", sa.String(length=80), nullable=False),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("is_containment", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("is_symmetric", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # Seed the built-ins (idempotent: skip keys already present). Timestamps are
    # supplied explicitly because the tables may have been created by
    # ``create_all`` (NOT NULL) rather than this migration.
    now = datetime.now(UTC)
    node_tbl = sa.table(
        "node_types",
        sa.column("key", sa.String),
        sa.column("label", sa.String),
        sa.column("icon", sa.String),
        sa.column("color", sa.String),
        sa.column("is_builtin", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    edge_tbl = sa.table(
        "edge_types",
        sa.column("key", sa.String),
        sa.column("label", sa.String),
        sa.column("is_builtin", sa.Boolean),
        sa.column("is_containment", sa.Boolean),
        sa.column("is_symmetric", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    existing_node_keys = {k for (k,) in bind.execute(sa.text("SELECT key FROM node_types")).all()}
    node_rows = [
        {"key": k, "label": lb, "icon": ic, "color": co, "is_builtin": True, "created_at": now, "updated_at": now}
        for (k, lb, ic, co) in _BUILTIN_NODE_TYPES
        if k not in existing_node_keys
    ]
    if node_rows:
        op.bulk_insert(node_tbl, node_rows)

    existing_edge_keys = {k for (k,) in bind.execute(sa.text("SELECT key FROM edge_types")).all()}
    edge_rows = [
        {
            "key": k,
            "label": lb,
            "is_builtin": True,
            "is_containment": bool(cont),
            "is_symmetric": False,
            "created_at": now,
            "updated_at": now,
        }
        for (k, lb, cont) in _BUILTIN_EDGE_TYPES
        if k not in existing_edge_keys
    ]
    if edge_rows:
        op.bulk_insert(edge_tbl, edge_rows)


def downgrade() -> None:
    op.drop_table("edge_types")
    op.drop_table("node_types")
