"""add_indexes

Revision ID: 456b53078436
Revises: 923ac25b7667
Create Date: 2026-05-29 17:46:43.967499
"""
from typing import Sequence, Union

from alembic import op


revision: str = '456b53078436'
down_revision: Union[str, None] = '923ac25b7667'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = [
    ("ix_activity_logs_project_id", "activity_logs", "project_id"),
    ("ix_activity_logs_task_id", "activity_logs", "task_id"),
    ("ix_attachments_task_id", "attachments", "task_id"),
    ("ix_comments_task_id", "comments", "task_id"),
    ("ix_cycles_project_id", "cycles", "project_id"),
    ("ix_labels_project_id", "labels", "project_id"),
    ("ix_notifications_created_at", "notifications", "created_at"),
    ("ix_notifications_read", "notifications", "read"),
    ("ix_tasks_parent_id", "tasks", "parent_id"),
    ("ix_tasks_project_id", "tasks", "project_id"),
    ("ix_tasks_status", "tasks", "status"),
    ("ix_webhook_deliveries_integration_id", "webhook_deliveries", "integration_id"),
    ("ix_webhook_deliveries_next_retry_at", "webhook_deliveries", "next_retry_at"),
    ("ix_webhook_deliveries_status", "webhook_deliveries", "status"),
]


def upgrade() -> None:
    for idx_name, table, column in _INDEXES:
        try:
            op.create_index(idx_name, table, [column])
        except Exception:
            pass  # Index already exists


def downgrade() -> None:
    for idx_name, table, _column in _INDEXES:
        try:
            op.drop_index(idx_name, table_name=table)
        except Exception:
            pass  # Index does not exist
