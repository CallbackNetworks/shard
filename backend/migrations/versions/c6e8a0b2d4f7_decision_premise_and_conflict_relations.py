"""a decision says what it takes as a premise and what it contradicts

ADR-0127. Two new built-in relations, both ``decision -> decision``:

``requires``        this decision holds only while that one does. Not ``supersedes``
                    (which retires the far end) and not ``depends_on`` (whose declared
                    meaning is "blocked until done", and a decision is never done).
``conflicts_with``  this decision contradicts that one. Stored one way like every edge
                    and read both ways, because the claim is symmetric.

Why a revision and not just the seed: ``seed_builtin_types`` inserts *missing* types on
startup, so the two rows would arrive on their own — but it never overwrites, so the
declaration resync below would not happen, and ADR-0119's fingerprint guard requires a
revision that re-applies every declared field whenever any of them changes. Doing both
here keeps "a built-in declaration reaches an existing database" one answer rather than
two, one of which only works for rows that did not exist yet.

Scope of the resync is the declarations, not the presentation: edge ``description`` /
``allowed_source`` / ``allowed_target`` / ``is_symmetric`` (ADR-0078, ADR-0127) and node
``fields`` (ADR-0074).
``label`` / ``icon`` / ``color`` / ``roles`` stay untouched — those are editable per
ADR-0079 and overwriting them would revert somebody's choice rather than correct a fact.

Revision ID: c6e8a0b2d4f7
Revises: b5d7f9a1c3e6
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6e8a0b2d4f7"
down_revision: str | None = "b5d7f9a1c3e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_RELATIONS = ("requires", "conflicts_with")

_NODE_TYPES = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
_EDGE_TYPES = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("description", sa.Text),
    sa.column("is_containment", sa.Boolean),
    sa.column("is_symmetric", sa.Boolean),
    sa.column("is_builtin", sa.Boolean),
    sa.column("allowed_source", sa.JSON),
    sa.column("allowed_target", sa.JSON),
    sa.column("created_at", sa.DateTime),
    sa.column("updated_at", sa.DateTime),
)


def upgrade() -> None:
    from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

    conn = op.get_bind()
    by_key = {spec["key"]: spec for spec in BUILTIN_EDGE_TYPES}
    existing = {k for (k,) in conn.execute(sa.select(_EDGE_TYPES.c.key)).all()}

    # A Core insert does not run ORM column defaults, so every column this table needs is
    # written explicitly here rather than left to the model.
    now = datetime.now(UTC).replace(tzinfo=None)
    for key in _NEW_RELATIONS:
        if key in existing:
            continue
        spec = by_key[key]
        conn.execute(
            _EDGE_TYPES.insert().values(
                key=key,
                label=spec["label"],
                description=spec.get("description"),
                is_containment=bool(spec.get("is_containment", False)),
                is_symmetric=bool(spec.get("is_symmetric", False)),
                is_builtin=True,
                allowed_source=spec.get("allowed_source"),
                allowed_target=spec.get("allowed_target"),
                created_at=now,
                updated_at=now,
            )
        )

    for spec in BUILTIN_NODE_TYPES:
        conn.execute(_NODE_TYPES.update().where(_NODE_TYPES.c.key == spec["key"]).values(fields=spec.get("fields")))
    for spec in BUILTIN_EDGE_TYPES:
        conn.execute(
            _EDGE_TYPES.update()
            .where(_EDGE_TYPES.c.key == spec["key"])
            .values(
                description=spec.get("description"),
                allowed_source=spec.get("allowed_source"),
                allowed_target=spec.get("allowed_target"),
                # ``is_symmetric`` joins the resynced set now that it decides behaviour
                # rather than describing one. It can never revert a user's choice: the
                # flag is already immutable on built-ins at the registry door.
                is_symmetric=bool(spec.get("is_symmetric", False)),
            )
        )


def downgrade() -> None:
    # The two relation rows go; the resynced declarations do not come back, for the same
    # reason b5d7f9a1c3e6's downgrade is a no-op — re-staling a description would serve a
    # false rule to agents rather than restore anything. Edges written with these relations
    # are left alone deliberately: dropping the type is not a licence to delete data.
    op.get_bind().execute(_EDGE_TYPES.delete().where(_EDGE_TYPES.c.key.in_(_NEW_RELATIONS)))
