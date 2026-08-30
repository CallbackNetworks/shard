"""drop assistant_messages.tool_call_id

Declared with the ``tool_calls`` column beside it and never written by any code path,
never read by any, never served in any response model. The assistant only ever stores
``role`` of ``user`` or ``assistant``; the ``tool`` role this column was shaped for is not
a row this system creates, because a tool result is folded into the assistant turn's
``tool_calls`` list instead.

The same class as ``edge_types.is_symmetric`` before ADR-0127 — a comment shaped like a
column. That one at least described a real intent somebody later implemented. This one
describes a message shape the assistant does not have, so it goes rather than waits.

Revision ID: e9b1c3d5f7a2
Revises: d8f0a2c4e6b1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9b1c3d5f7a2"
down_revision: str | None = "d8f0a2c4e6b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Guarded because the model no longer declares the column, and a FRESH database is
    # built by ``create_all()`` and *stamped* to head rather than migrated (ADR-0064) —
    # so this revision is replayed only against schemas that may or may not still carry
    # it, and ``test_db_schema`` replays the whole chain over a ``create_all`` schema
    # that does not.
    conn = op.get_bind()
    columns = {c["name"] for c in sa.inspect(conn).get_columns("assistant_messages")}
    if "tool_call_id" not in columns:
        return
    # Batch mode: SQLite has no DROP COLUMN before 3.35 and Alembic is configured for
    # table rebuilds throughout this project.
    with op.batch_alter_table("assistant_messages") as batch:
        batch.drop_column("tool_call_id")


def downgrade() -> None:
    with op.batch_alter_table("assistant_messages") as batch:
        batch.add_column(sa.Column("tool_call_id", sa.String(length=100), nullable=True))
