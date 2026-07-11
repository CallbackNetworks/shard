"""add project ical token

Revision ID: f7a9c1b3d5e2
Revises: c7d9e1f3a5b7
Create Date: 2026-07-11 00:00:00.000000
"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "f7a9c1b3d5e2"
down_revision: Union[str, None] = "c7d9e1f3a5b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c["name"] for c in inspector.get_columns("projects")]

    if "ical_token" not in cols:
        with op.batch_alter_table("projects", schema=None) as batch_op:
            batch_op.add_column(sa.Column("ical_token", sa.String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM projects WHERE ical_token IS NULL OR ical_token = ''")).fetchall()
    for row in rows:
        bind.execute(
            text("UPDATE projects SET ical_token = :ical_token WHERE id = :id"),
            {"ical_token": str(uuid.uuid4()), "id": row[0]},
        )

    indexes = {idx["name"] for idx in inspector.get_indexes("projects")}
    if "ix_projects_ical_token" not in indexes:
        op.create_index("ix_projects_ical_token", "projects", ["ical_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_projects_ical_token", table_name="projects")
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("ical_token")
