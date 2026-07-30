"""integrations gain a source filter (ADR-0048)

Revision ID: d1e3f5a7b9c2
Revises: c0d2e4f6a8b1
Create Date: 2026-07-30 00:00:00.000000

Rule-made changes now go through the task pipeline, so they produce the same events a
human-made change produces. That is the point — but it means an integration subscribed
to ``task.done`` starts hearing from the automation too. ``sources`` lets each
integration narrow to the causes it cares about. Nullable with no default: null means
"every source", so every existing row keeps delivering exactly what it delivered before.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e3f5a7b9c2"
down_revision: str | None = "c0d2e4f6a8b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("integrations") as batch_op:
        batch_op.add_column(sa.Column("sources", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch_op:
        batch_op.drop_column("sources")
