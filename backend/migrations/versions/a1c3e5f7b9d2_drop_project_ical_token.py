"""drop project ical token

The dedicated per-project ical_token (added in f7a9c1b3d5e2) is superseded by a
global personal feed plus identity/project feeds keyed on the existing
share_token. See ADR-0023.

Revision ID: a1c3e5f7b9d2
Revises: f7a9c1b3d5e2
Create Date: 2026-07-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "a1c3e5f7b9d2"
down_revision: Union[str, None] = "f7a9c1b3d5e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    indexes = {idx["name"] for idx in inspector.get_indexes("projects")}
    if "ix_projects_ical_token" in indexes:
        op.drop_index("ix_projects_ical_token", table_name="projects")

    cols = [c["name"] for c in inspector.get_columns("projects")]
    if "ical_token" in cols:
        with op.batch_alter_table("projects", schema=None) as batch_op:
            batch_op.drop_column("ical_token")


def downgrade() -> None:
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ical_token", sa.String(length=36), nullable=True))
    op.create_index("ix_projects_ical_token", "projects", ["ical_token"], unique=True)
