"""index edge lookups by rel_type; record webhook signature digests

Two unrelated additions, one revision because both are additive index/column work
on tables nothing else in this chain touches.

1. ``edges`` gains ``(target_id, rel_type)`` and ``(source_id, rel_type)``. Every
   containment walk filters on a node id *and* a rel_type; ``uq_edge`` leads with
   ``source_id`` so it cannot serve the target-side lookup, which is the one
   ``parents_of`` / ``ancestors_of`` and therefore every access check performs.

2. ``webhook_events`` gains ``signature_digest`` for replay detection. Nullable,
   because only body-bound signature schemes produce one and every existing row
   predates it — a NULL must never look like a duplicate.

Revision ID: b4a592a18793
Revises: 7c28cd4fc24b
Create Date: 2026-08-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "b4a592a18793"
down_revision: Union[str, None] = "7c28cd4fc24b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EDGE_INDEXES = (
    ("ix_edge_target_rel", ["target_id", "rel_type"]),
    ("ix_edge_source_rel", ["source_id", "rel_type"]),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing = {ix["name"] for ix in inspector.get_indexes("edges")}
    for name, columns in _EDGE_INDEXES:
        if name not in existing:
            op.create_index(name, "edges", columns)

    columns = {c["name"] for c in inspector.get_columns("webhook_events")}
    if "signature_digest" not in columns:
        with op.batch_alter_table("webhook_events") as batch_op:
            batch_op.add_column(sa.Column("signature_digest", sa.String(length=64), nullable=True))
        op.create_index("ix_webhook_events_signature_digest", "webhook_events", ["signature_digest"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing = {ix["name"] for ix in inspector.get_indexes("webhook_events")}
    if "ix_webhook_events_signature_digest" in existing:
        op.drop_index("ix_webhook_events_signature_digest", table_name="webhook_events")
    columns = {c["name"] for c in inspector.get_columns("webhook_events")}
    if "signature_digest" in columns:
        with op.batch_alter_table("webhook_events") as batch_op:
            batch_op.drop_column("signature_digest")

    existing = {ix["name"] for ix in inspector.get_indexes("edges")}
    for name, _columns in _EDGE_INDEXES:
        if name in existing:
            op.drop_index(name, table_name="edges")
