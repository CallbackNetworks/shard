"""collapse identities table to node-only (ADR-0033 Phase B)

Revision ID: c9d1e3f5a7b8
Revises: b8c0d2e4f6a7
Create Date: 2026-07-17 03:00:00.000000

Identities become node-only. Each ``identities`` row is folded into its ``nodes``
row (title = name; color/description/avatar/share_token/share_pin_hash/
share_expires_at/allow_guest_notes into ``data``; ``share_expires_at`` as an ISO
string). Identities are top-level (projects attach via ``member_of`` edges, tasks
via ``assigned_to`` edges), so there is no ``contains`` edge to backfill and those
edges are left untouched. The mirror node already carries the full ``data`` bag
(from the original backfill); this migration re-asserts it defensively before
dropping the table. Count conservation: one node per identity, no new edges.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "c9d1e3f5a7b8"
down_revision: Union[str, None] = "b8c0d2e4f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "identities" not in inspector.get_table_names():
        return

    identities = (
        bind.execute(
            sa.text(
                "SELECT id, name, color, description, avatar, share_token, "
                "share_pin_hash, share_expires_at, allow_guest_notes, created_at FROM identities"
            )
        )
        .mappings()
        .all()
    )

    for row in identities:
        identity_id = row["id"]
        data = {
            "color": row["color"],
            "description": row["description"],
            "avatar": row["avatar"],
            "share_token": row["share_token"],
            "share_pin_hash": row["share_pin_hash"],
            "share_expires_at": _iso(row["share_expires_at"]),
            "allow_guest_notes": bool(row["allow_guest_notes"]),
        }
        data_json = json.dumps(data)

        node = bind.execute(sa.text("SELECT id FROM nodes WHERE id = :id"), {"id": identity_id}).first()
        if node is None:
            bind.execute(
                sa.text(
                    "INSERT INTO nodes (id, type, title, position, is_pinned, data, created_at) "
                    "VALUES (:id, 'identity', :title, 0, :false, :data, :created_at)"
                ),
                {
                    "id": identity_id,
                    "title": row["name"] or "",
                    "false": False,
                    "data": data_json,
                    "created_at": row["created_at"],
                },
            )
        else:
            bind.execute(
                sa.text("UPDATE nodes SET title = :title, data = :data WHERE id = :id"),
                {"id": identity_id, "title": row["name"] or "", "data": data_json},
            )

    op.drop_table("identities")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "identities" in inspector.get_table_names():
        return

    op.create_table(
        "identities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="#5e6ad2"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("avatar", sa.String(length=10), nullable=True),
        sa.Column("share_token", sa.String(length=36), nullable=False, unique=True),
        sa.Column("share_pin_hash", sa.String(length=128), nullable=True),
        sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("allow_guest_notes", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    identity_nodes = (
        bind.execute(sa.text("SELECT id, title, data, created_at FROM nodes WHERE type = 'identity'")).mappings().all()
    )

    for node in identity_nodes:
        raw = node["data"]
        data = raw if isinstance(raw, dict) else (json.loads(raw) if raw else {})
        if not isinstance(data, dict):
            data = {}
        bind.execute(
            sa.text(
                "INSERT INTO identities (id, name, color, description, avatar, share_token, "
                "share_pin_hash, share_expires_at, allow_guest_notes, created_at) VALUES "
                "(:id, :name, :color, :description, :avatar, :share_token, "
                ":share_pin_hash, :share_expires_at, :allow_guest_notes, :created_at)"
            ),
            {
                "id": node["id"],
                "name": node["title"] or "",
                "color": data.get("color") or "#5e6ad2",
                "description": data.get("description"),
                "avatar": data.get("avatar"),
                "share_token": data.get("share_token") or node["id"],
                "share_pin_hash": data.get("share_pin_hash"),
                "share_expires_at": data.get("share_expires_at"),
                "allow_guest_notes": bool(data.get("allow_guest_notes", False)),
                "created_at": node["created_at"],
            },
        )
