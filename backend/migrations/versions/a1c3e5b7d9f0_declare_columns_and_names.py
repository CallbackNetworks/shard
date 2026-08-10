"""re-apply built-in field declarations: names and task columns

A declaration only described a node's ``data``, so it covered half of it. Every page
still had to hand-roll a box for the name (the ``title`` column), and a task form drawn
from the declaration would have offered assignee and estimate while status, priority and
the dates lived somewhere else. Field specs can now say ``store: "column"`` (ADR-0074).

Same shape as f6b8d0c2e4a3: the seed never overwrites, so a change to a built-in
declaration only reaches an existing database through a revision like this one.

Revision ID: a1c3e5b7d9f0
Revises: f6b8d0c2e4a3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3e5b7d9f0"
down_revision: str | None = "f6b8d0c2e4a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    from app.services.graph_registry import BUILTIN_NODE_TYPES

    node_types = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
    conn = op.get_bind()
    for spec in BUILTIN_NODE_TYPES:
        conn.execute(node_types.update().where(node_types.c.key == spec["key"]).values(fields=spec.get("fields")))


def downgrade() -> None:
    # The previous declarations are not recoverable from here; a custom type's own
    # declarations are untouched either way.
    pass
