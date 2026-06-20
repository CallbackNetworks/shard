"""add missing indexes for fk columns

Revision ID: 00844465140f
Revises: 3bfff3233dd6
Create Date: 2026-06-20 15:13:52.616718
"""
from typing import Sequence, Union

from alembic import op


revision: str = '00844465140f'
down_revision: Union[str, None] = '3bfff3233dd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = [
    ("ix_integrations_project_id", "integrations", "project_id"),
    ("ix_notifications_project_id", "notifications", "project_id"),
    ("ix_notifications_task_id", "notifications", "task_id"),
    ("ix_assistant_messages_conversation_id", "assistant_messages", "conversation_id"),
    ("ix_comments_project_id", "comments", "project_id"),
    ("ix_activity_logs_created_at", "activity_logs", "created_at"),
    ("ix_webhook_events_task_id_created_at", "webhook_events", ["task_id", "created_at"]),
]


def upgrade() -> None:
    for entry in _INDEXES:
        idx_name, table = entry[0], entry[1]
        columns = entry[2] if isinstance(entry[2], list) else [entry[2]]
        try:
            op.create_index(idx_name, table, columns)
        except Exception:
            pass


def downgrade() -> None:
    for entry in _INDEXES:
        idx_name, table = entry[0], entry[1]
        try:
            op.drop_index(idx_name, table_name=table)
        except Exception:
            pass
