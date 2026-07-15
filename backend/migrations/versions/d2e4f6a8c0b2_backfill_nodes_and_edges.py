"""backfill nodes and edges from existing entities and relations

Revision ID: d2e4f6a8c0b2
Revises: c1a2b3d4e5f6
Create Date: 2026-07-15 00:00:01.000000

See ADR-0032. Copies Project/Task/Identity/Goal/Cycle/Label rows into ``nodes``
(reusing their UUIDs) and translates project_id / parent_id and the five
association tables into ``edges``. Idempotent: skips if ``nodes`` already has
rows. Old tables remain the authoritative source at this stage.
"""
import datetime
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e4f6a8c0b2"
down_revision: Union[str, None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _as_dict(value):
    """Normalize a possibly JSON-encoded column value to a Python object."""
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _ser(value):
    """Make a value JSON-serializable for the ``data`` column."""
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    return value


def _clean(payload: dict) -> dict | None:
    cleaned = {k: _ser(v) for k, v in payload.items() if v is not None}
    return cleaned or None


def _nodes_table() -> sa.Table:
    meta = sa.MetaData()
    return sa.Table(
        "nodes",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("type", sa.String(20)),
        sa.Column("title", sa.String(255)),
        sa.Column("status", sa.String(20)),
        sa.Column("priority", sa.String(20)),
        sa.Column("start_date", sa.DateTime(timezone=True)),
        sa.Column("due_date", sa.DateTime(timezone=True)),
        sa.Column("position", sa.Integer),
        sa.Column("is_pinned", sa.Boolean),
        sa.Column("data", sa.JSON),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def _edges_table() -> sa.Table:
    meta = sa.MetaData()
    return sa.Table(
        "edges",
        meta,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_id", sa.String(36)),
        sa.Column("target_id", sa.String(36)),
        sa.Column("rel_type", sa.String(30)),
        sa.Column("position", sa.Integer),
        sa.Column("data", sa.JSON),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )


def upgrade() -> None:
    bind = op.get_bind()
    nodes = _nodes_table()
    edges = _edges_table()

    # Idempotency guard: a populated nodes table means backfill already ran.
    if bind.execute(sa.select(sa.func.count()).select_from(nodes)).scalar() or 0:
        return

    src = sa.MetaData()
    src.reflect(
        bind=bind,
        only=[
            "projects",
            "tasks",
            "identities",
            "goals",
            "cycles",
            "labels",
            "project_identities",
            "goal_projects",
            "task_dependencies",
            "task_labels",
            "cycle_tasks",
        ],
    )

    node_rows: list[dict] = []
    edge_rows: list[dict] = []

    def edge(source_id, target_id, rel_type, *, position=0):
        edge_rows.append(
            {
                "id": str(uuid.uuid4()),
                "source_id": source_id,
                "target_id": target_id,
                "rel_type": rel_type,
                "position": position or 0,
                "data": None,
                "created_at": datetime.datetime.now(datetime.UTC),
            }
        )

    # --- Projects ---
    for r in bind.execute(sa.select(src.tables["projects"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "project",
                "title": r["name"],
                "status": r["status"],
                "priority": None,
                "start_date": None,
                "due_date": None,
                "position": 0,
                "is_pinned": False,
                "data": _clean(
                    {
                        "description": r["description"],
                        "share_token": r["share_token"],
                        "share_expires_at": r["share_expires_at"],
                        "allow_guest_notes": r["allow_guest_notes"],
                        "agent_instructions": r["agent_instructions"],
                        "repo_url": r["repo_url"],
                        "wip_limits": _as_dict(r["wip_limits"]),
                    }
                ),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )

    # --- Tasks (+ contains edges from project_id and parent_id) ---
    for r in bind.execute(sa.select(src.tables["tasks"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "task",
                "title": r["title"],
                "status": r["status"],
                "priority": r["priority"],
                "start_date": r["start_date"],
                "due_date": r["due_date"],
                "position": r["position"] or 0,
                "is_pinned": bool(r["is_pinned"]),
                "data": _clean(
                    {
                        "description": r["description"],
                        "callback_token": r["callback_token"],
                        "webhook_secret": r["webhook_secret"],
                        "assignee": r["assignee"],
                        "assigned_agent_key_id": r["assigned_agent_key_id"],
                        "reminder_sent_at": r["reminder_sent_at"],
                        "time_estimate": r["time_estimate"],
                        "time_spent": r["time_spent"],
                        "progress_pct": r["progress_pct"],
                        "agent_notes": r["agent_notes"],
                        "external_provider": r["external_provider"],
                        "external_id": r["external_id"],
                        "external_url": r["external_url"],
                        "external_repo": r["external_repo"],
                    }
                ),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )
        if r["project_id"]:
            edge(r["project_id"], r["id"], "contains", position=r["position"] or 0)
        if r["parent_id"]:
            edge(r["parent_id"], r["id"], "contains", position=r["position"] or 0)

    # --- Identities ---
    for r in bind.execute(sa.select(src.tables["identities"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "identity",
                "title": r["name"],
                "status": None,
                "priority": None,
                "start_date": None,
                "due_date": None,
                "position": 0,
                "is_pinned": False,
                "data": _clean(
                    {
                        "color": r["color"],
                        "description": r["description"],
                        "avatar": r["avatar"],
                        "share_token": r["share_token"],
                        "share_pin_hash": r["share_pin_hash"],
                        "share_expires_at": r["share_expires_at"],
                        "allow_guest_notes": r["allow_guest_notes"],
                    }
                ),
                "created_at": r["created_at"],
                "updated_at": r["created_at"],
            }
        )

    # --- Goals ---
    for r in bind.execute(sa.select(src.tables["goals"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "goal",
                "title": r["title"],
                "status": r["status"],
                "priority": None,
                "start_date": None,
                "due_date": r["target_date"],
                "position": 0,
                "is_pinned": False,
                "data": _clean({"description": r["description"]}),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )

    # --- Cycles ---
    for r in bind.execute(sa.select(src.tables["cycles"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "cycle",
                "title": r["name"],
                "status": r["status"],
                "priority": None,
                "start_date": r["start_date"],
                "due_date": r["end_date"],
                "position": 0,
                "is_pinned": False,
                "data": _clean({"description": r["description"]}),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )

    # --- Labels ---
    for r in bind.execute(sa.select(src.tables["labels"])).mappings():
        node_rows.append(
            {
                "id": r["id"],
                "type": "label",
                "title": r["name"],
                "status": None,
                "priority": None,
                "start_date": None,
                "due_date": None,
                "position": 0,
                "is_pinned": False,
                "data": _clean(
                    {
                        "color": r["color"],
                        "label_type": r["type"],
                        "description": r["description"],
                        "decision_status": r["decision_status"],
                        "source": r["source"],
                    }
                ),
                "created_at": r["created_at"],
                "updated_at": r["created_at"],
            }
        )

    # --- Association tables -> edges ---
    for r in bind.execute(sa.select(src.tables["project_identities"])).mappings():
        edge(r["identity_id"], r["project_id"], "member_of")
    for r in bind.execute(sa.select(src.tables["goal_projects"])).mappings():
        edge(r["project_id"], r["goal_id"], "part_of")
    for r in bind.execute(sa.select(src.tables["task_dependencies"])).mappings():
        edge(r["task_id"], r["depends_on_id"], "depends_on")
    for r in bind.execute(sa.select(src.tables["task_labels"])).mappings():
        edge(r["task_id"], r["label_id"], "labeled")
    for r in bind.execute(sa.select(src.tables["cycle_tasks"])).mappings():
        edge(r["task_id"], r["cycle_id"], "in_cycle")

    if node_rows:
        bind.execute(nodes.insert(), node_rows)
    if edge_rows:
        bind.execute(edges.insert(), edge_rows)


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM edges"))
    bind.execute(sa.text("DELETE FROM nodes"))
