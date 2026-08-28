"""a decision is its own node type, with relations of its own

ADR-0118. Four things, because they are one change:

1. Register the ``decision`` node type and the ``supersedes`` / ``governs`` relations
   (``seed_builtin_types`` only inserts *missing* types, so a new built-in reaches an
   existing database only through a revision like this one).
2. Move every decision record off ``label``. A decision was a ``Node(type="label")``
   carrying ``data.type="decision"`` (ADR-0004); it becomes ``Node(type="decision")`` and
   the now-redundant ``data.type`` key is dropped, because a value the node's own type
   already carries, left in ``data``, is the declared-vs-actual drift ADR-0074 closed.
3. Re-point the ``labeled`` edges that attached a decision to a task. Direction reverses:
   a task was *labeled with* a decision, a decision *governs* the task. Left alone these
   would violate their own declaration, which ``tests/test_edge_semantics.py`` asserts
   against every edge in the database.
4. Resync the built-in ``label`` field declarations and the ``labeled`` description, which
   both still described the decisions-as-labels convention.

The data moves are done in Python rather than SQL because the discriminator lives inside a
JSON column, and JSON extraction is the one thing SQLite and PostgreSQL spell differently —
the same reason ``graph.decisions`` filtered in Python before this revision existed.

Revision ID: a3c5e7d9b1f4
Revises: d601757ef2ef
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c5e7d9b1f4"
down_revision: str | None = "d601757ef2ef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NODES = sa.table(
    "nodes",
    sa.column("id", sa.String),
    sa.column("type", sa.String),
    sa.column("data", sa.JSON),
)
_EDGES = sa.table(
    "edges",
    sa.column("id", sa.String),
    sa.column("source_id", sa.String),
    sa.column("target_id", sa.String),
    sa.column("rel_type", sa.String),
)
_NODE_TYPES = sa.table(
    "node_types",
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("icon", sa.String),
    sa.column("color", sa.String),
    sa.column("is_builtin", sa.Boolean),
    sa.column("roles", sa.JSON),
    sa.column("fields", sa.JSON),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
_EDGE_TYPES = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("description", sa.Text),
    sa.column("is_builtin", sa.Boolean),
    sa.column("is_containment", sa.Boolean),
    sa.column("allowed_source", sa.JSON),
    sa.column("allowed_target", sa.JSON),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)


def _spec(specs: list[dict], key: str) -> dict:
    return next(s for s in specs if s["key"] == key)


def upgrade() -> None:
    from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

    conn = op.get_bind()
    # A Core insert does not run the ORM's ``default=now_utc``, and these columns are
    # nullable, so leaving them out writes a row with no timestamps rather than failing.
    now = datetime.now(UTC)

    # 1. Vocabulary.
    existing_nodes = {k for (k,) in conn.execute(sa.select(_NODE_TYPES.c.key))}
    if "decision" not in existing_nodes:
        spec = _spec(BUILTIN_NODE_TYPES, "decision")
        conn.execute(
            _NODE_TYPES.insert().values(is_builtin=True, roles=None, created_at=now, updated_at=now, **spec)
        )

    existing_edges = {k for (k,) in conn.execute(sa.select(_EDGE_TYPES.c.key))}
    for key in ("supersedes", "governs"):
        if key in existing_edges:
            continue
        spec = _spec(BUILTIN_EDGE_TYPES, key)
        conn.execute(
            _EDGE_TYPES.insert().values(
                key=spec["key"],
                label=spec["label"],
                description=spec.get("description"),
                is_builtin=True,
                is_containment=False,
                allowed_source=spec.get("allowed_source"),
                allowed_target=spec.get("allowed_target"),
                created_at=now,
                updated_at=now,
            )
        )

    # 2. The records themselves.
    decision_ids: list[str] = []
    for node_id, data in conn.execute(
        sa.select(_NODES.c.id, _NODES.c.data).where(_NODES.c.type == "label")
    ).all():
        if not isinstance(data, dict) or data.get("type") != "decision":
            continue
        decision_ids.append(node_id)
        payload = {k: v for k, v in data.items() if k != "type"}
        payload.setdefault("decision_status", "proposed")
        conn.execute(_NODES.update().where(_NODES.c.id == node_id).values(type="decision", data=payload))

    # 3. task --labeled--> decision  becomes  decision --governs--> task.
    if decision_ids:
        for edge_id, source_id, target_id in conn.execute(
            sa.select(_EDGES.c.id, _EDGES.c.source_id, _EDGES.c.target_id).where(
                _EDGES.c.rel_type == "labeled", _EDGES.c.target_id.in_(decision_ids)
            )
        ).all():
            conn.execute(
                _EDGES.update()
                .where(_EDGES.c.id == edge_id)
                .values(rel_type="governs", source_id=target_id, target_id=source_id)
            )

    # 4. Declarations that still described the old convention.
    label_spec = _spec(BUILTIN_NODE_TYPES, "label")
    conn.execute(_NODE_TYPES.update().where(_NODE_TYPES.c.key == "label").values(fields=label_spec["fields"]))
    labeled_spec = _spec(BUILTIN_EDGE_TYPES, "labeled")
    conn.execute(
        _EDGE_TYPES.update().where(_EDGE_TYPES.c.key == "labeled").values(description=labeled_spec["description"])
    )


def downgrade() -> None:
    conn = op.get_bind()

    decision_ids = [
        node_id for (node_id,) in conn.execute(sa.select(_NODES.c.id).where(_NODES.c.type == "decision")).all()
    ]

    # governs -> labeled, reversing the direction back.
    for edge_id, source_id, target_id in conn.execute(
        sa.select(_EDGES.c.id, _EDGES.c.source_id, _EDGES.c.target_id).where(_EDGES.c.rel_type == "governs")
    ).all():
        conn.execute(
            _EDGES.update()
            .where(_EDGES.c.id == edge_id)
            .values(rel_type="labeled", source_id=target_id, target_id=source_id)
        )
    conn.execute(_EDGES.delete().where(_EDGES.c.rel_type == "supersedes"))

    for node_id in decision_ids:
        (data,) = conn.execute(sa.select(_NODES.c.data).where(_NODES.c.id == node_id)).one()
        payload = dict(data or {})
        payload["type"] = "decision"
        conn.execute(_NODES.update().where(_NODES.c.id == node_id).values(type="label", data=payload))

    conn.execute(_EDGE_TYPES.delete().where(_EDGE_TYPES.c.key.in_(["supersedes", "governs"])))
    conn.execute(_NODE_TYPES.delete().where(_NODE_TYPES.c.key == "decision"))
