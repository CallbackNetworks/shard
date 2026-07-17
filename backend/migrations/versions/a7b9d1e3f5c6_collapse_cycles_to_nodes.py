"""collapse cycles table to node-only (ADR-0033 Phase B)

Revision ID: a7b9d1e3f5c6
Revises: f6a8c0d2e4b5
Create Date: 2026-07-17 01:00:00.000000

Cycles become node-only. Each ``cycles`` row is folded into its ``nodes`` row
(title = name; status/start_date real columns; end_date -> node ``due_date``;
description into ``data``) and its project scope becomes a ``contains`` edge
(project -> cycle). The mirror node already carries the hot columns and (from the
original backfill) the description, but the project containment edge was never
populated, so this migration backfills it before dropping the table. Count
conservation: one node + one contains edge per cycle.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "a7b9d1e3f5c6"
down_revision: Union[str, None] = "f6a8c0d2e4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "cycles" not in inspector.get_table_names():
        return

    cycles = (
        bind.execute(
            sa.text(
                "SELECT id, project_id, name, description, start_date, end_date, "
                "status, created_at, updated_at FROM cycles"
            )
        )
        .mappings()
        .all()
    )

    for row in cycles:
        cycle_id = row["id"]
        node = bind.execute(
            sa.text("SELECT id, data FROM nodes WHERE id = :id"), {"id": cycle_id}
        ).mappings().first()

        if node is None:
            data = {"description": row["description"]} if row["description"] is not None else None
            bind.execute(
                sa.text(
                    "INSERT INTO nodes (id, type, title, status, start_date, due_date, "
                    "position, is_pinned, data, created_at, updated_at) VALUES "
                    "(:id, 'cycle', :title, :status, :start_date, :due_date, 0, :false, "
                    ":data, :created_at, :updated_at)"
                ),
                {
                    "id": cycle_id,
                    "title": row["name"] or "",
                    "status": row["status"],
                    "start_date": row["start_date"],
                    "due_date": row["end_date"],
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
                    "UPDATE nodes SET title = :title, status = :status, start_date = :start_date, "
                    "due_date = :due_date, data = :data WHERE id = :id"
                ),
                {
                    "id": cycle_id,
                    "title": row["name"] or "",
                    "status": row["status"],
                    "start_date": row["start_date"],
                    "due_date": row["end_date"],
                    "data": json.dumps(data) if data else None,
                },
            )

        # Project -> cycle containment edge (skip if it already exists).
        project_id = row["project_id"]
        if project_id:
            exists = bind.execute(
                sa.text("SELECT id FROM edges WHERE source_id = :s AND target_id = :t AND rel_type = 'contains'"),
                {"s": project_id, "t": cycle_id},
            ).first()
            if exists is None:
                bind.execute(
                    sa.text(
                        "INSERT INTO edges (id, source_id, target_id, rel_type, position, created_at) "
                        "VALUES (:id, :s, :t, 'contains', 0, :created_at)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "s": project_id,
                        "t": cycle_id,
                        "created_at": datetime.now(timezone.utc),
                    },
                )

    op.drop_table("cycles")
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS cycle_status")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "cycles" in inspector.get_table_names():
        return

    op.create_table(
        "cycles",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum("draft", "active", "completed", name="cycle_status"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    cycle_nodes = (
        bind.execute(
            sa.text("SELECT id, title, status, start_date, due_date, data, created_at, updated_at FROM nodes WHERE type = 'cycle'")
        )
        .mappings()
        .all()
    )

    for node in cycle_nodes:
        cycle_id = node["id"]
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        if not isinstance(data, dict):
            data = {}
        edge = bind.execute(
            sa.text(
                "SELECT source_id FROM edges WHERE target_id = :t AND rel_type = 'contains' "
                "AND source_id IN (SELECT id FROM nodes WHERE type = 'project')"
            ),
            {"t": cycle_id},
        ).first()
        project_id = edge[0] if edge else None
        if project_id is None:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO cycles (id, project_id, name, description, start_date, end_date, "
                "status, created_at, updated_at) VALUES "
                "(:id, :project_id, :name, :description, :start_date, :end_date, "
                ":status, :created_at, :updated_at)"
            ),
            {
                "id": cycle_id,
                "project_id": project_id,
                "name": node["title"] or "",
                "description": data.get("description"),
                "start_date": node["start_date"],
                "end_date": node["due_date"],
                "status": node["status"] or "draft",
                "created_at": node["created_at"],
                "updated_at": node["updated_at"],
            },
        )
        # Restore pre-migration edge state: project->cycle contains edges did not exist.
        bind.execute(
            sa.text("DELETE FROM edges WHERE target_id = :t AND rel_type = 'contains' AND source_id = :s"),
            {"t": cycle_id, "s": project_id},
        )
