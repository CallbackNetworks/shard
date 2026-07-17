"""drop tasks table — task becomes node-only (ADR-0033 Phase B, B5.3)

Revision ID: d3f5a7b9c1e2
Revises: d1e3f5a7b9c0
Create Date: 2026-07-17 05:00:00.000000

Tasks collapse to ``Node(type="task")``. The task node mirror is already complete
(hot columns + full ``data`` bag, backfilled in ``d1e3f5a7b9c0``), so this
migration only rewires the five peripheral tables that FK-reference ``tasks.id``
(``comments``/``attachments``/``recurrence_rules``/``task_pull_requests``/
``webhook_events``) to point at ``nodes.id`` and drops the ``tasks`` table (plus
the PostgreSQL ``task_status``/``task_priority`` enum types).

PostgreSQL enforces foreign keys, so the constraints must be dropped and recreated
against ``nodes`` before the table can go. SQLite does not enable ``PRAGMA
foreign_keys`` (see app/database.py), so its inline FK text becomes inert once the
table is gone and fresh databases build the ``nodes.id`` FK straight from the
models; there we simply drop the table.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "d3f5a7b9c1e2"
down_revision: Union[str, None] = "d1e3f5a7b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# peripheral table -> its FK column that referenced tasks.id
_FK_COLUMNS = {
    "comments": "task_id",
    "attachments": "task_id",
    "recurrence_rules": "template_task_id",
    "task_pull_requests": "task_id",
    "webhook_events": "task_id",
}

_DATA_SCALARS = (
    "description",
    "callback_token",
    "webhook_secret",
    "assignee",
    "assigned_agent_key_id",
    "reminder_sent_at",
    "time_estimate",
    "time_spent",
    "progress_pct",
    "agent_notes",
    "external_provider",
    "external_id",
    "external_url",
    "external_repo",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "tasks" not in inspector.get_table_names():
        return
    dialect = bind.dialect.name

    if dialect == "postgresql":
        for table, col in _FK_COLUMNS.items():
            op.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_{col}_fkey')
            op.execute(
                f'ALTER TABLE {table} ADD CONSTRAINT {table}_{col}_nodes_fkey '
                f'FOREIGN KEY ({col}) REFERENCES nodes (id) ON DELETE CASCADE'
            )
        op.drop_table("tasks")
        op.execute("DROP TYPE IF EXISTS task_status")
        op.execute("DROP TYPE IF EXISTS task_priority")
    else:
        # SQLite: FK enforcement is off; just drop the table.
        op.drop_table("tasks")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "tasks" in inspector.get_table_names():
        return
    dialect = bind.dialect.name

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="todo"),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("callback_token", sa.String(length=36), nullable=True, unique=True),
        sa.Column("webhook_secret", sa.String(length=128), nullable=True),
        sa.Column("assignee", sa.String(length=255), nullable=True),
        sa.Column("assigned_agent_key_id", sa.String(length=36), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("time_estimate", sa.Integer(), nullable=True),
        sa.Column("time_spent", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_pct", sa.Integer(), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("agent_notes", sa.Text(), nullable=True),
        sa.Column("external_provider", sa.String(length=20), nullable=True),
        sa.Column("external_id", sa.String(length=100), nullable=True),
        sa.Column("external_url", sa.String(length=2048), nullable=True),
        sa.Column("external_repo", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    task_nodes = (
        bind.execute(
            sa.text(
                "SELECT id, title, status, priority, start_date, due_date, position, "
                "is_pinned, data, created_at, updated_at FROM nodes WHERE type = 'task'"
            )
        )
        .mappings()
        .all()
    )
    for node in task_nodes:
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        if not isinstance(data, dict):
            data = {}
        params = {
            "id": node["id"],
            "title": node["title"] or "",
            "status": node["status"] or "todo",
            "priority": node["priority"] or "medium",
            "start_date": node["start_date"],
            "due_date": node["due_date"],
            "position": node["position"] or 0,
            "is_pinned": bool(node["is_pinned"]),
            "created_at": node["created_at"],
            "updated_at": node["updated_at"],
        }
        for key in _DATA_SCALARS:
            params[key] = data.get(key)
        cols = ", ".join(params.keys())
        binds = ", ".join(f":{k}" for k in params.keys())
        bind.execute(sa.text(f"INSERT INTO tasks ({cols}) VALUES ({binds})"), params)

    if dialect == "postgresql":
        for table, col in _FK_COLUMNS.items():
            op.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_{col}_nodes_fkey')
            op.execute(
                f'ALTER TABLE {table} ADD CONSTRAINT {table}_{col}_fkey '
                f'FOREIGN KEY ({col}) REFERENCES tasks (id) ON DELETE CASCADE'
            )
