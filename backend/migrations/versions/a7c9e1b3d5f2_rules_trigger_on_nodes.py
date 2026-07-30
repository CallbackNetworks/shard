"""rules trigger on nodes, not tasks (ADR-0049)

Revision ID: a7c9e1b3d5f2
Revises: d1e3f5a7b9c2
Create Date: 2026-07-30 00:00:00.000000

``task.created`` becomes ``node.created``, which fires for *every* node type. Left
alone, an existing rule would silently widen from "when a task is created" to "when
anything is created" — including labels and cycles — and start running its actions
against nodes it was never written for.

So every migrated rule gains a leading ``has_role eq task`` condition, which reproduces
its old scope exactly. Role rather than a list of type keys: types are runtime data, so
an enumeration would quietly exclude a task-like type the user adds later.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c9e1b3d5f2"
down_revision: str | None = "d1e3f5a7b9c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TASK_ROLE_CONDITION = {"field": "has_role", "op": "eq", "value": "task"}


def _rewrite(connection, *, from_trigger: str, to_trigger: str, add_condition: bool) -> None:
    """Move rules between triggers, adding or removing the task-role condition."""
    rows = connection.execute(
        sa.text("SELECT id, conditions FROM workflow_rules WHERE trigger = :t"), {"t": from_trigger}
    ).fetchall()
    for rule_id, raw in rows:
        conditions = json.loads(raw) if isinstance(raw, str) else (raw or [])
        if add_condition:
            if TASK_ROLE_CONDITION not in conditions:
                conditions = [TASK_ROLE_CONDITION, *conditions]
        else:
            conditions = [c for c in conditions if c != TASK_ROLE_CONDITION]
        connection.execute(
            sa.text("UPDATE workflow_rules SET trigger = :to, conditions = :c WHERE id = :id"),
            {"to": to_trigger, "c": json.dumps(conditions), "id": rule_id},
        )


def upgrade() -> None:
    _rewrite(op.get_bind(), from_trigger="task.created", to_trigger="node.created", add_condition=True)


def downgrade() -> None:
    # Rules written against node.created for a non-task type have no task-era equivalent;
    # they land back on task.created, where the old engine simply never fires them.
    _rewrite(op.get_bind(), from_trigger="node.created", to_trigger="task.created", add_condition=False)
