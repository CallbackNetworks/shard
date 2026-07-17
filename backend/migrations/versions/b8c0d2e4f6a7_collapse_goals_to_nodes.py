"""collapse goals table to node-only (ADR-0033 Phase B)

Revision ID: b8c0d2e4f6a7
Revises: a7b9d1e3f5c6
Create Date: 2026-07-17 02:00:00.000000

Goals become node-only. Each ``goals`` row is folded into its ``nodes`` row
(title = title; status a real column; target_date -> node ``due_date``;
description into ``data``). Unlike labels/cycles a goal is NOT project-scoped —
projects link to it via ``part_of`` edges, which already exist independently — so
there is no ``contains`` edge to backfill. The mirror node already carries the hot
columns and (from the original backfill) the description; this migration re-asserts
them defensively before dropping the table. Count conservation: one node per goal,
no new edges.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "b8c0d2e4f6a7"
down_revision: Union[str, None] = "a7b9d1e3f5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "goals" not in inspector.get_table_names():
        return

    goals = (
        bind.execute(sa.text("SELECT id, title, description, status, target_date, created_at, updated_at FROM goals"))
        .mappings()
        .all()
    )

    for row in goals:
        goal_id = row["id"]
        node = bind.execute(sa.text("SELECT id, data FROM nodes WHERE id = :id"), {"id": goal_id}).mappings().first()

        if node is None:
            data = {"description": row["description"]} if row["description"] is not None else None
            bind.execute(
                sa.text(
                    "INSERT INTO nodes (id, type, title, status, due_date, position, is_pinned, "
                    "data, created_at, updated_at) VALUES "
                    "(:id, 'goal', :title, :status, :due_date, 0, :false, :data, :created_at, :updated_at)"
                ),
                {
                    "id": goal_id,
                    "title": row["title"] or "",
                    "status": row["status"],
                    "due_date": row["target_date"],
                    "false": False,
                    "data": json.dumps(data) if data else None,
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                },
            )
        else:
            raw = node["data"]
            data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
            if not isinstance(data, dict):
                data = {}
            data["description"] = row["description"]
            bind.execute(
                sa.text(
                    "UPDATE nodes SET title = :title, status = :status, due_date = :due_date, data = :data WHERE id = :id"
                ),
                {
                    "id": goal_id,
                    "title": row["title"] or "",
                    "status": row["status"],
                    "due_date": row["target_date"],
                    "data": json.dumps(data) if data else None,
                },
            )

    op.drop_table("goals")
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS goal_status")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "goals" in inspector.get_table_names():
        return

    op.create_table(
        "goals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "completed", "cancelled", name="goal_status"),
            nullable=True,
        ),
        sa.Column("target_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    goal_nodes = (
        bind.execute(
            sa.text("SELECT id, title, status, due_date, data, created_at, updated_at FROM nodes WHERE type = 'goal'")
        )
        .mappings()
        .all()
    )

    for node in goal_nodes:
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        if not isinstance(data, dict):
            data = {}
        bind.execute(
            sa.text(
                "INSERT INTO goals (id, title, description, status, target_date, created_at, updated_at) "
                "VALUES (:id, :title, :description, :status, :target_date, :created_at, :updated_at)"
            ),
            {
                "id": node["id"],
                "title": node["title"] or "",
                "description": data.get("description"),
                "status": node["status"] or "active",
                "target_date": node["due_date"],
                "created_at": node["created_at"],
                "updated_at": node["updated_at"],
            },
        )
