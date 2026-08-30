"""put every decision record where the decision surfaces look for it

Three repairs of one shape, plus the resync ADR-0119 requires whenever a built-in
declaration changes.

**The misfiled records.** ADR-0118 moved a decision out of ``label`` + ``data.type =
"decision"`` into its own node type, and said the old shape would stop working visibly.
It did not: ``POST /nodes`` with the old shape returns 201 and creates a label, which
``decisions()`` (filtering on ``Node.type``) never sees and — since ADR-0118 also removed
``label_names``'s subtraction — the label vocabulary now does. Production collected 17
of them over two days: the newest 17 decisions in the database, none on the decisions
page, all in the label picker. They are converted here and the marker key dropped;
``assert_decision_write_shape`` refuses the shape at the door from now on.

**The status.** A decision's state rode in ``data["decision_status"]`` because a label
had nowhere else to put it, leaving ``nodes.status`` NULL on all 103 production records —
the one node type whose state a generic filter could not narrow by. Backfilled into the
column (ADR-0130); the response contract still says ``decision_status``.

**The stale supersession.** Two records carried ``data["superseded_by"]`` naming their
successor, written before ADR-0118 made supersession an edge. Nothing reads that key, so
each was a second source of truth that only disagreed. Where the named successor still
exists the real ``supersedes`` edge is created from it; then the key goes. Deleting it
without that would throw away the one thing it knew.

Revision ID: d8f0a2c4e6b1
Revises: c6e8a0b2d4f7
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8f0a2c4e6b1"
down_revision: str | None = "c6e8a0b2d4f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NODE_TYPES = sa.table("node_types", sa.column("key", sa.String), sa.column("fields", sa.JSON))
_NODES = sa.table(
    "nodes",
    sa.column("id", sa.String),
    sa.column("type", sa.String),
    sa.column("status", sa.String),
    sa.column("data", sa.JSON),
)
_EDGE_TYPES = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("description", sa.Text),
    sa.column("allowed_source", sa.JSON),
    sa.column("allowed_target", sa.JSON),
    sa.column("is_symmetric", sa.Boolean),
)
_EDGES = sa.table(
    "edges",
    sa.column("id", sa.String),
    sa.column("source_id", sa.String),
    sa.column("target_id", sa.String),
    sa.column("rel_type", sa.String),
    sa.column("position", sa.Integer),
    sa.column("created_at", sa.DateTime(timezone=True)),
)

_DEFAULT_STATUS = "proposed"


def upgrade() -> None:
    conn = op.get_bind()

    # 1. label + data.type="decision"  ->  a decision node.
    misfiled = conn.execute(sa.select(_NODES.c.id, _NODES.c.data).where(_NODES.c.type == "label")).mappings().all()
    for row in misfiled:
        data = dict(row["data"] or {})
        if data.get("type") != "decision" and "decision_status" not in data:
            continue
        status = data.pop("decision_status", None) or _DEFAULT_STATUS
        data.pop("type", None)
        conn.execute(
            _NODES.update().where(_NODES.c.id == row["id"]).values(type="decision", status=status, data=data or None)
        )

    # 2. data["decision_status"] -> nodes.status, on every decision record.
    decisions = (
        conn.execute(sa.select(_NODES.c.id, _NODES.c.status, _NODES.c.data).where(_NODES.c.type == "decision"))
        .mappings()
        .all()
    )
    known = {row["id"] for row in decisions} | {row["id"] for row in misfiled}
    for row in decisions:
        data = dict(row["data"] or {})
        stored = data.pop("decision_status", None)
        superseded_by = data.pop("superseded_by", None)
        status = row["status"] or stored or _DEFAULT_STATUS

        # 3. data["superseded_by"] -> the supersedes edge it predates, successor first.
        if superseded_by and superseded_by in known:
            existing = conn.execute(
                sa.select(_EDGES.c.id).where(
                    _EDGES.c.source_id == superseded_by,
                    _EDGES.c.target_id == row["id"],
                    _EDGES.c.rel_type == "supersedes",
                )
            ).first()
            if existing is None:
                conn.execute(
                    _EDGES.insert().values(
                        id=str(uuid.uuid4()),
                        source_id=superseded_by,
                        target_id=row["id"],
                        rel_type="supersedes",
                        # Spelled out because a Core insert does not run the ORM's
                        # Python-side defaults, and both columns are NOT NULL.
                        position=0,
                        created_at=datetime.now(UTC),
                    )
                )
        if stored is None and superseded_by is None and row["status"]:
            continue
        conn.execute(_NODES.update().where(_NODES.c.id == row["id"]).values(status=status, data=data or None))

    # 4. The declaration change this rides on (ADR-0119): decision's Status field is a
    # column now. ``seed_builtin_types`` only inserts missing types, so without this the
    # generic editor on every existing database keeps offering the old ``data`` key.
    #
    # Both registries in full rather than the one type that changed: a resync that covers
    # only today's edit is how a declaration goes stale between revisions, which is the
    # failure ADR-0119 exists to end. Re-applying is idempotent.
    from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

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
                is_symmetric=bool(spec.get("is_symmetric")),
            )
        )


def downgrade() -> None:
    # Deliberately one-way. Going back would have to guess which of the decision records
    # were labels before, and re-misfiling them is not a state worth restoring; the status
    # is left in the column, where a downgraded reader defaults it to "proposed" rather
    # than reading a wrong one.
    pass
