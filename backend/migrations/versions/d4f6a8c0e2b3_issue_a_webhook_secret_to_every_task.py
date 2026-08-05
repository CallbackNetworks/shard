"""issue a webhook secret to every task that can receive a callback (ADR-0060)

Revision ID: d4f6a8c0e2b3
Revises: c2e4a6b8d0f1
Create Date: 2026-08-05 00:00:00.000000

The inbound callback now refuses unsigned requests, so a task without a secret cannot
receive one at all. Every task created from here on is issued a secret at creation; this
gives one to everything that already exists.

The rows are selected by capability rather than by type: a node holding a
``callback_token`` is exactly a node the callback endpoint will route to, whatever its
node type happens to be (a user-defined task-like type is a first-class task, ADR-0035).
Asking the type registry instead would mean re-deriving the task-role set inside a
migration, where it may not match the registry the running code will read.
"""

import json
import secrets
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6a8c0e2b3"
down_revision: str | None = "c2e4a6b8d0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, data FROM nodes WHERE data IS NOT NULL")).fetchall()
    for node_id, raw in rows:
        data = raw if isinstance(raw, dict) else json.loads(raw or "{}")
        if not data.get("callback_token") or data.get("webhook_secret"):
            continue
        data["webhook_secret"] = secrets.token_hex(32)
        connection.execute(
            sa.text("UPDATE nodes SET data = :data WHERE id = :id"),
            {"data": json.dumps(data), "id": node_id},
        )


def downgrade() -> None:
    """Deliberately a no-op.

    Which secrets this migration minted is not recorded, and stripping every secret to be
    sure would re-open unauthenticated writes on tasks whose owners had set one by hand.
    Leaving them costs nothing: older code treats a secret as optional and simply checks
    signatures against it.
    """
