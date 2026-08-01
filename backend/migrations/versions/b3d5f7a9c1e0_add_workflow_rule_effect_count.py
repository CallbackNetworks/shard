"""workflow rules count effects, not just runs (ADR-0053)

Revision ID: b3d5f7a9c1e0
Revises: a7c9e1b3d5f2
Create Date: 2026-08-01 00:00:00.000000

``run_count`` answers "did this rule fire". It has always been read as "is this rule
doing something", which is a different question: a rule whose every action is a no-op or
a skip reaches 47 runs looking perfectly healthy. ``effect_count`` counts the runs that
changed something.

Existing rows backfill to 0 rather than to ``run_count``. Copying run_count would assert
that every past run had an effect, which is exactly the claim this column exists to stop
making; 0 is honestly "not measured yet" and self-corrects on the next run.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d5f7a9c1e0"
down_revision: str | None = "a7c9e1b3d5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("workflow_rules") as batch:
        batch.add_column(sa.Column("effect_count", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("workflow_rules") as batch:
        batch.drop_column("effect_count")
