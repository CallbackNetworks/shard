"""drop tasks.project_id and tasks.parent_id — containment is now contains edges

Revision ID: d8e0f2a4b6c8
Revises: b6c8d0e2f4a6
Create Date: 2026-07-16 00:00:00.000000

See ADR-0032 (no-primary, fully multi-container). Task containment moved from the
``project_id`` / ``parent_id`` FK columns to graph ``contains`` edges. The backfill
(d2e4f6a8c0b2) already created a ``project -> task`` edge for every task and a
``parent-task -> task`` edge for every subtask, so dropping the columns loses no
information. Downgrade re-adds the columns (nullable) and backfills them from the
edges.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "d8e0f2a4b6c8"
down_revision: Union[str, None] = "b6c8d0e2f4a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("tasks")}
    with op.batch_alter_table("tasks") as batch:
        if "parent_id" in cols:
            batch.drop_column("parent_id")
        if "project_id" in cols:
            batch.drop_column("project_id")


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("tasks")}
    with op.batch_alter_table("tasks") as batch:
        if "project_id" not in cols:
            batch.add_column(sa.Column("project_id", sa.String(length=36), nullable=True))
        if "parent_id" not in cols:
            batch.add_column(sa.Column("parent_id", sa.String(length=36), nullable=True))

    # Backfill from contains edges: project->task gives project_id, task->task gives parent_id.
    bind.execute(
        sa.text(
            """
            UPDATE tasks SET project_id = (
                SELECT e.source_id FROM edges e JOIN nodes n ON n.id = e.source_id
                WHERE e.target_id = tasks.id AND e.rel_type = 'contains' AND n.type = 'project'
                LIMIT 1
            )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE tasks SET parent_id = (
                SELECT e.source_id FROM edges e JOIN nodes n ON n.id = e.source_id
                WHERE e.target_id = tasks.id AND e.rel_type = 'contains' AND n.type = 'task'
                LIMIT 1
            )
            """
        )
    )
