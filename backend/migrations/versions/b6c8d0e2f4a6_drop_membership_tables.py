"""drop project_identities and goal_projects tables — now member_of / part_of edges

Revision ID: b6c8d0e2f4a6
Revises: a5b7c9d1e3f5
Create Date: 2026-07-15 00:04:00.000000

See ADR-0032. Identity↔project membership and goal↔project membership moved to
member_of / part_of edges. The backfill (d2e4f6a8c0b2) already copied every row
into an edge, so dropping the tables loses no data. These were the last two
association tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "b6c8d0e2f4a6"
down_revision: Union[str, None] = "a5b7c9d1e3f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "project_identities" in tables:
        op.drop_table("project_identities")
    if "goal_projects" in tables:
        op.drop_table("goal_projects")


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "project_identities" not in tables:
        op.create_table(
            "project_identities",
            sa.Column(
                "project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
            ),
            sa.Column(
                "identity_id",
                sa.String(length=36),
                sa.ForeignKey("identities.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )
    if "goal_projects" not in tables:
        op.create_table(
            "goal_projects",
            sa.Column("goal_id", sa.String(length=36), sa.ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True),
            sa.Column(
                "project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
            ),
        )
