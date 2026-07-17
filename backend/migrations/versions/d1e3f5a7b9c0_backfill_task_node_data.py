"""backfill task non-hot fields into node.data (ADR-0033 Phase B, B5.1)

Revision ID: d1e3f5a7b9c0
Revises: c9d1e3f5a7b8
Create Date: 2026-07-17 04:00:00.000000

Step 1 of collapsing ``tasks`` to node-only: make each task node a COMPLETE
mirror of its ``tasks`` row. The graph_sync listener only mirrored the hot
columns (title/status/priority/dates/position/is_pinned); this migration copies
the remaining fields (description, callback_token, webhook_secret, assignee,
assigned_agent_key_id, reminder_sent_at as ISO, time_estimate, time_spent,
progress_pct, agent_notes, external_*) into ``node.data`` so reads can later be
served from the node. The ``tasks`` table itself is untouched here (dropped in a
later step). Idempotent; does not create or delete rows.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "d1e3f5a7b9c0"
down_revision: str | None = "c9d1e3f5a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NON_HOT = (
    "description",
    "callback_token",
    "webhook_secret",
    "assignee",
    "assigned_agent_key_id",
    "time_estimate",
    "time_spent",
    "progress_pct",
    "agent_notes",
    "external_provider",
    "external_id",
    "external_url",
    "external_repo",
)


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "tasks" not in inspector.get_table_names():
        return

    rows = (
        bind.execute(
            sa.text(
                "SELECT id, description, callback_token, webhook_secret, assignee, "
                "assigned_agent_key_id, reminder_sent_at, time_estimate, time_spent, "
                "progress_pct, agent_notes, external_provider, external_id, external_url, "
                "external_repo FROM tasks"
            )
        )
        .mappings()
        .all()
    )

    for row in rows:
        data = {key: row[key] for key in _NON_HOT}
        data["reminder_sent_at"] = _iso(row["reminder_sent_at"])
        bind.execute(
            sa.text("UPDATE nodes SET data = :data WHERE id = :id AND type = 'task'"),
            {"id": row["id"], "data": json.dumps(data)},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "tasks" not in inspector.get_table_names():
        return
    # Pre-B5.1 state: task nodes carried only hot columns, no data bag.
    bind.execute(sa.text("UPDATE nodes SET data = NULL WHERE type = 'task'"))
