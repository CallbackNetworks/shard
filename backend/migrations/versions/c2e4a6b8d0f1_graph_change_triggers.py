"""rules trigger on graph changes, not only creation (ADR-0055)

Revision ID: c2e4a6b8d0f1
Revises: b3d5f7a9c1e0
Create Date: 2026-08-01 00:00:00.000000

The three task-specific triggers are special cases of two graph-shaped ones: a field
change is ``node.updated``, a label assignment is an ``edge.added`` of type ``labeled``.
They are rewritten into that form, with the distinguishing detail moved into a condition.

Both replacements are *wider* than what they replace — ``node.updated`` fires for every
node and every field — so each migrated rule also gains ``has_role eq task`` if it does
not already carry it. Without that a rule written for tasks would silently start running
against projects and labels, which is the failure ADR-0049 hit on the same move.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2e4a6b8d0f1"
down_revision: str | None = "b3d5f7a9c1e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TASK_ROLE_CONDITION = {"field": "has_role", "op": "eq", "value": "task"}

# old trigger -> (new trigger, the condition that preserves its meaning)
FORWARD = {
    "task.status_changed": ("node.updated", {"field": "changed_field", "op": "eq", "value": "status"}),
    "task.priority_changed": ("node.updated", {"field": "changed_field", "op": "eq", "value": "priority"}),
    "task.label_added": ("edge.added", {"field": "edge_type", "op": "eq", "value": "labeled"}),
}


def _rules(connection, trigger: str):
    rows = connection.execute(
        sa.text("SELECT id, conditions FROM workflow_rules WHERE trigger = :t"), {"t": trigger}
    ).fetchall()
    for rule_id, raw in rows:
        yield rule_id, (json.loads(raw) if isinstance(raw, str) else (raw or []))


def _save(connection, rule_id, trigger: str, conditions: list) -> None:
    connection.execute(
        sa.text("UPDATE workflow_rules SET trigger = :t, conditions = :c WHERE id = :id"),
        {"t": trigger, "c": json.dumps(conditions), "id": rule_id},
    )


def upgrade() -> None:
    connection = op.get_bind()
    for old_trigger, (new_trigger, marker) in FORWARD.items():
        for rule_id, conditions in list(_rules(connection, old_trigger)):
            if marker not in conditions:
                conditions = [marker, *conditions]
            if TASK_ROLE_CONDITION not in conditions:
                conditions = [TASK_ROLE_CONDITION, *conditions]
            _save(connection, rule_id, new_trigger, conditions)


def downgrade() -> None:
    # Only rules carrying the marker condition have a task-era equivalent. Anything
    # written against the generalised triggers — a rule on a project's status, a rule on
    # a ``contains`` edge — has no old trigger to return to and is left where it is,
    # inert under the old engine rather than silently rewritten into something else.
    connection = op.get_bind()
    for old_trigger, (new_trigger, marker) in FORWARD.items():
        for rule_id, conditions in list(_rules(connection, new_trigger)):
            if marker not in conditions:
                continue
            remaining = [c for c in conditions if c != marker and c != TASK_ROLE_CONDITION]
            _save(connection, rule_id, old_trigger, remaining)
