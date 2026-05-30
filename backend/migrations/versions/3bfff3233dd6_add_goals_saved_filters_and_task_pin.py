"""add goals saved_filters and task pin

Revision ID: 3bfff3233dd6
Revises: fa6bfeefbe1f
Create Date: 2026-05-30 21:15:13.683544
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '3bfff3233dd6'
down_revision: Union[str, None] = 'fa6bfeefbe1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = inspector.get_table_names()

    if 'goals' not in existing:
        op.create_table('goals',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(), server_default='active', nullable=False),
            sa.Column('target_date', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

    if 'goal_projects' not in existing:
        op.create_table('goal_projects',
            sa.Column('goal_id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(['goal_id'], ['goals.id']),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
            sa.PrimaryKeyConstraint('goal_id', 'project_id')
        )

    if 'saved_filters' not in existing:
        op.create_table('saved_filters',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=True),
            sa.Column('filters', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
            sa.PrimaryKeyConstraint('id')
        )

    # new columns (use try/except for idempotency with create_all)
    cols_projects = [c['name'] for c in inspector.get_columns('projects')]
    if 'wip_limits' not in cols_projects:
        with op.batch_alter_table('projects', schema=None) as batch_op:
            batch_op.add_column(sa.Column('wip_limits', sa.JSON(), nullable=True))

    cols_tasks = [c['name'] for c in inspector.get_columns('tasks')]
    if 'is_pinned' not in cols_tasks:
        with op.batch_alter_table('tasks', schema=None) as batch_op:
            batch_op.add_column(sa.Column('is_pinned', sa.Boolean(), nullable=False, server_default=sa.text('0')))


def downgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_column('is_pinned')

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_column('wip_limits')

    op.drop_table('saved_filters')
    op.drop_table('goal_projects')
    op.drop_table('goals')
