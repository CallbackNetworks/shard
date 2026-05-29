"""add agent_instructions, progress_pct, agent_notes

Revision ID: 925c7e57b28a
Revises: 41dbbc9439f9
Create Date: 2026-05-29 19:57:44.603285
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '925c7e57b28a'
down_revision: Union[str, None] = '41dbbc9439f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _col_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        if not _col_exists("projects", "agent_instructions"):
            batch_op.add_column(sa.Column("agent_instructions", sa.Text(), nullable=True))

    with op.batch_alter_table("tasks") as batch_op:
        if not _col_exists("tasks", "progress_pct"):
            batch_op.add_column(sa.Column("progress_pct", sa.Integer(), nullable=True))
        if not _col_exists("tasks", "agent_notes"):
            batch_op.add_column(sa.Column("agent_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("agent_notes")
        batch_op.drop_column("progress_pct")

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("agent_instructions")
