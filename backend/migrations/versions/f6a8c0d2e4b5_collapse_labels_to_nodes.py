"""collapse labels table to node-only (ADR-0033 Phase B)

Revision ID: f6a8c0d2e4b5
Revises: e5f7a9b1c3d4
Create Date: 2026-07-17 00:00:00.000000

Labels become node-only. Each ``labels`` row is folded into its ``nodes`` row
(title = name; color/type/description/decision_status/source into ``data``) and
its project scope becomes a ``contains`` edge (project -> label). The mirror node
already exists for every label (graph_sync), but its ``data`` and the project
containment edge were never populated, so this migration backfills both before
dropping the table. Count conservation: one node + one contains edge per label.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "f6a8c0d2e4b5"
down_revision: Union[str, None] = "e5f7a9b1c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "labels" not in inspector.get_table_names():
        return

    labels = (
        bind.execute(
            sa.text(
                "SELECT id, project_id, name, color, type, description, "
                "decision_status, source, created_at FROM labels"
            )
        )
        .mappings()
        .all()
    )

    for row in labels:
        label_id = row["id"]
        data = {
            "color": row["color"],
            "type": row["type"],
            "description": row["description"],
            "decision_status": row["decision_status"],
            "source": row["source"],
        }
        data_json = json.dumps(data)

        node = bind.execute(sa.text("SELECT id FROM nodes WHERE id = :id"), {"id": label_id}).first()
        if node is None:
            bind.execute(
                sa.text(
                    "INSERT INTO nodes (id, type, title, position, is_pinned, data, created_at) "
                    "VALUES (:id, 'label', :title, 0, :false, :data, :created_at)"
                ),
                {
                    "id": label_id,
                    "title": row["name"] or "",
                    "false": False,
                    "data": data_json,
                    "created_at": row["created_at"],
                },
            )
        else:
            bind.execute(
                sa.text("UPDATE nodes SET title = :title, data = :data WHERE id = :id"),
                {"id": label_id, "title": row["name"] or "", "data": data_json},
            )

        # Project -> label containment edge (skip if it already exists).
        project_id = row["project_id"]
        if project_id:
            exists = bind.execute(
                sa.text("SELECT id FROM edges WHERE source_id = :s AND target_id = :t " "AND rel_type = 'contains'"),
                {"s": project_id, "t": label_id},
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
                        "t": label_id,
                        "created_at": datetime.now(timezone.utc),
                    },
                )

    op.drop_table("labels")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "labels" in inspector.get_table_names():
        return

    op.create_table(
        "labels",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#5e6ad2"),
        sa.Column("type", sa.String(length=20), nullable=False, server_default="label"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("decision_status", sa.String(length=20), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Rebuild rows from label nodes and their containing project edge.
    label_nodes = (
        bind.execute(sa.text("SELECT id, title, data, created_at FROM nodes WHERE type = 'label'")).mappings().all()
    )

    for node in label_nodes:
        label_id = node["id"]
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        edge = bind.execute(
            sa.text(
                "SELECT source_id FROM edges WHERE target_id = :t AND rel_type = 'contains' "
                "AND source_id IN (SELECT id FROM nodes WHERE type = 'project')"
            ),
            {"t": label_id},
        ).first()
        project_id = edge[0] if edge else None
        if project_id is None:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO labels (id, project_id, name, color, type, description, "
                "decision_status, source, created_at) VALUES "
                "(:id, :project_id, :name, :color, :type, :description, "
                ":decision_status, :source, :created_at)"
            ),
            {
                "id": label_id,
                "project_id": project_id,
                "name": node["title"] or "",
                "color": data.get("color") or "#5e6ad2",
                "type": data.get("type") or "label",
                "description": data.get("description"),
                "decision_status": data.get("decision_status"),
                "source": data.get("source"),
                "created_at": node["created_at"],
            },
        )
        # Restore pre-migration edge state: project->label contains edges did not exist.
        bind.execute(
            sa.text("DELETE FROM edges WHERE target_id = :t AND rel_type = 'contains' AND source_id = :s"),
            {"t": label_id, "s": project_id},
        )
