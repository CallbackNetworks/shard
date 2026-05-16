"""add assigned_agent_key_id to tasks

Revision ID: 923ac25b7667
Revises: d30b32886576
Create Date: 2026-05-16 06:42:10.284996
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '923ac25b7667'
down_revision: Union[str, None] = 'd30b32886576'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('assigned_agent_key_id', sa.String(length=36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_column('assigned_agent_key_id')
