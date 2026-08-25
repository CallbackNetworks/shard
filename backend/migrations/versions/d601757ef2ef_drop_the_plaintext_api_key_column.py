"""drop the plaintext api_keys.key column

Authentication has only ever matched on ``key_hash`` (routers/external_api/auth.py),
and every key issued since hashing landed was written with ``key=None``. The column
was residue — but a column that can hold a credential is a place one can come back,
and it is the kind of residue that shows up in a backup, an export, or a screenshot
of a database browser.

Dropping it cannot lock anyone out: a row with a plaintext value and no hash could
not authenticate before this migration either.

Irreversible in the way that matters — ``downgrade`` restores the column, empty. The
values are not recoverable from ``key_hash``, which is the point of hashing them.

Revision ID: d601757ef2ef
Revises: b4a592a18793
Create Date: 2026-08-25 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "d601757ef2ef"
down_revision: Union[str, None] = "b4a592a18793"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if "key" not in {c["name"] for c in inspector.get_columns("api_keys")}:
        return
    # batch_alter_table so SQLite gets the table rebuild it needs to drop a column
    # that carries a UNIQUE constraint.
    with op.batch_alter_table("api_keys") as batch_op:
        batch_op.drop_column("key")


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "key" in {c["name"] for c in inspector.get_columns("api_keys")}:
        return
    with op.batch_alter_table("api_keys") as batch_op:
        batch_op.add_column(sa.Column("key", sa.String(length=64), nullable=True))
