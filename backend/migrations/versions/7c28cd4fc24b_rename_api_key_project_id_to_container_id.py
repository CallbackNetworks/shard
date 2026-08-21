"""rename api_keys.project_id to container_id (ADR-0107)

Revision ID: 7c28cd4fc24b
Revises: d4f6a8c0e2b1
Create Date: 2026-08-21 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "7c28cd4fc24b"
down_revision: Union[str, None] = "d4f6a8c0e2b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("api_keys")}
    if "container_id" in columns:
        return
    with op.batch_alter_table("api_keys") as batch_op:
        batch_op.alter_column("project_id", new_column_name="container_id", existing_type=sa.String(length=36))


def downgrade() -> None:
    with op.batch_alter_table("api_keys") as batch_op:
        batch_op.alter_column("container_id", new_column_name="project_id", existing_type=sa.String(length=36))
