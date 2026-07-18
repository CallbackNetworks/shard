"""drop projects table — project becomes node-only (ADR-0033 Phase B, B6)

Revision ID: e2f4a6b8c0d3
Revises: d3f5a7b9c1e2
Create Date: 2026-07-17 06:00:00.000000

``project`` is the last entity-backed type. Its node mirror only ever carried the
hot columns (title=name, status) via the old ``graph_sync`` listener, so this
migration first folds the remaining fields (description, share_token,
share_expires_at as ISO, allow_guest_notes, agent_instructions, repo_url,
wip_limits) into ``node.data`` — creating the node if one is somehow missing —
then drops the ``projects`` table (plus the PostgreSQL ``project_status`` enum).

No table foreign-keys ``projects.id`` (``api_keys``/``assistant_conversations``/
``activity_logs``/``comments``/``attachments`` all keep ``project_id`` as a plain
string), so there are no constraints to rewire — unlike the task drop (B5.3).
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "e2f4a6b8c0d3"
down_revision: str | None = "d3f5a7b9c1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# project non-hot fields folded into node.data (title=name and status are hot).
_DATA_SCALARS = (
    "description",
    "share_token",
    "agent_instructions",
    "repo_url",
)


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _json_val(value):
    """Normalize a JSON column read via raw SQL (str on SQLite, dict on PG)."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value
    return value


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "projects" not in inspector.get_table_names():
        return
    dialect = bind.dialect.name

    rows = (
        bind.execute(
            sa.text(
                "SELECT id, name, status, description, share_token, share_expires_at, "
                "allow_guest_notes, agent_instructions, repo_url, wip_limits, "
                "created_at, updated_at FROM projects"
            )
        )
        .mappings()
        .all()
    )

    for row in rows:
        data = {key: row[key] for key in _DATA_SCALARS}
        data["share_expires_at"] = _iso(row["share_expires_at"])
        data["allow_guest_notes"] = bool(row["allow_guest_notes"])
        data["wip_limits"] = _json_val(row["wip_limits"])
        payload = {
            "id": row["id"],
            "title": row["name"] or "",
            "status": row["status"] or "active",
            "data": json.dumps(data),
        }
        result = bind.execute(
            sa.text("UPDATE nodes SET title = :title, status = :status, data = :data WHERE id = :id AND type = 'project'"),
            payload,
        )
        if result.rowcount == 0:
            bind.execute(
                sa.text(
                    "INSERT INTO nodes (id, type, title, status, data, created_at, updated_at) "
                    "VALUES (:id, 'project', :title, :status, :data, :created_at, :updated_at)"
                ),
                {**payload, "created_at": row["created_at"], "updated_at": row["updated_at"]},
            )

    op.drop_table("projects")
    if dialect == "postgresql":
        op.execute("DROP TYPE IF EXISTS project_status")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "projects" in inspector.get_table_names():
        return

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("share_token", sa.String(length=36), nullable=True, unique=True),
        sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("allow_guest_notes", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("agent_instructions", sa.Text(), nullable=True),
        sa.Column("repo_url", sa.String(length=2048), nullable=True),
        sa.Column("wip_limits", sa.JSON(), nullable=True),
    )

    project_nodes = (
        bind.execute(
            sa.text("SELECT id, title, status, data, created_at, updated_at FROM nodes WHERE type = 'project'")
        )
        .mappings()
        .all()
    )
    for node in project_nodes:
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        if not isinstance(data, dict):
            data = {}
        wip = data.get("wip_limits")
        params = {
            "id": node["id"],
            "name": node["title"] or "",
            "status": node["status"] or "active",
            "description": data.get("description"),
            "share_token": data.get("share_token"),
            "share_expires_at": data.get("share_expires_at"),
            "allow_guest_notes": bool(data.get("allow_guest_notes", False)),
            "agent_instructions": data.get("agent_instructions"),
            "repo_url": data.get("repo_url"),
            "wip_limits": json.dumps(wip) if wip is not None else None,
            "created_at": node["created_at"],
            "updated_at": node["updated_at"],
        }
        cols = ", ".join(params.keys())
        binds = ", ".join(f":{k}" for k in params.keys())
        bind.execute(sa.text(f"INSERT INTO projects ({cols}) VALUES ({binds})"), params)
