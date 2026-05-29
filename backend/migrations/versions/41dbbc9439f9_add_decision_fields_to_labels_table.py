"""add decision fields to labels table

Revision ID: 41dbbc9439f9
Revises: 456b53078436
Create Date: 2026-05-29 19:27:22.368839
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '41dbbc9439f9'
down_revision: Union[str, None] = '456b53078436'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('type', sa.String(length=20), nullable=False, server_default='label'))
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('decision_status', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('source', sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('labels', schema=None) as batch_op:
        batch_op.drop_column('source')
        batch_op.drop_column('decision_status')
        batch_op.drop_column('description')
        batch_op.drop_column('type')
