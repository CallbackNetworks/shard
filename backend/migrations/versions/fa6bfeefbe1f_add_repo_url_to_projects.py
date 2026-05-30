"""add repo_url to projects

Revision ID: fa6bfeefbe1f
Revises: 6fcd6b8edc46
Create Date: 2026-05-30 20:41:39.983672
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa6bfeefbe1f'
down_revision: Union[str, None] = '6fcd6b8edc46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('repo_url', sa.String(length=2048), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('repo_url')
