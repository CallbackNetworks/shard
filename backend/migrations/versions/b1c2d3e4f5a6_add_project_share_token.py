"""add project share token

Revision ID: b1c2d3e4f5a6
Revises: 00844465140f
Create Date: 2026-06-28 10:35:00.000000
"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "00844465140f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c["name"] for c in inspector.get_columns("projects")]

    if "share_token" not in cols:
        with op.batch_alter_table("projects", schema=None) as batch_op:
            batch_op.add_column(sa.Column("share_token", sa.String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM projects WHERE share_token IS NULL OR share_token = ''")).fetchall()
    for row in rows:
        bind.execute(
            text("UPDATE projects SET share_token = :share_token WHERE id = :id"),
            {"share_token": str(uuid.uuid4()), "id": row[0]},
        )

    indexes = {idx["name"] for idx in inspector.get_indexes("projects")}
    if "ix_projects_share_token" not in indexes:
        op.create_index("ix_projects_share_token", "projects", ["share_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_projects_share_token", table_name="projects")
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("share_token")
