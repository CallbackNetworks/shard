"""add graph_events append-only audit table (ADR-0033)

Revision ID: d4e6f8a0b2c3
Revises: c3d5e7f9a1b2
Create Date: 2026-07-16 00:10:00.000000

Provenance as an audit trail (see ADR-0033): records node/edge additions and
removals with actor and timestamp. Idempotent.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "d4e6f8a0b2c3"
down_revision: Union[str, None] = "c3d5e7f9a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if "graph_events" in set(inspect(bind).get_table_names()):
        return
    op.create_table(
        "graph_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("event", sa.String(length=30), nullable=False),
        sa.Column("node_id", sa.String(length=36), nullable=True),
        sa.Column("source_id", sa.String(length=36), nullable=True),
        sa.Column("target_id", sa.String(length=36), nullable=True),
        sa.Column("rel_type", sa.String(length=30), nullable=True),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_graph_events_event", "graph_events", ["event"], unique=False)
    op.create_index("ix_graph_events_node_id", "graph_events", ["node_id"], unique=False)
    op.create_index("ix_graph_events_source_id", "graph_events", ["source_id"], unique=False)
    op.create_index("ix_graph_events_target_id", "graph_events", ["target_id"], unique=False)
    op.create_index("ix_graph_events_created_at", "graph_events", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_table("graph_events")
