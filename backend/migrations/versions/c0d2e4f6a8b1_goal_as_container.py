"""goal becomes a container: part_of -> contains, add container role (ADR-0041)

Revision ID: c0d2e4f6a8b1
Revises: b8d0f2a4c6e9
Create Date: 2026-07-23 00:00:00.000000

ADR-0041 folds the one-off ``part_of`` (project -> goal) edge into the generic
container model: a goal now plays the ``container`` role and its members are its
outgoing ``contains`` children. This migration reverses every existing
``part_of`` edge (project -> goal) into ``contains`` (goal -> project) in place,
grants the ``goal`` node type the ``container`` role, and retires the ``part_of``
edge type. render_as_batch is unnecessary here (no column changes), and the
work is pure data movement so it is dialect-agnostic.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0d2e4f6a8b1"
down_revision: str | None = "b8d0f2a4c6e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_edges = sa.table(
    "edges",
    sa.column("id", sa.String),
    sa.column("source_id", sa.String),
    sa.column("target_id", sa.String),
    sa.column("rel_type", sa.String),
)
_node_types = sa.table(
    "node_types",
    sa.column("key", sa.String),
    sa.column("roles", sa.JSON),
)
_edge_types = sa.table(
    "edge_types",
    sa.column("key", sa.String),
    sa.column("label", sa.String),
    sa.column("is_builtin", sa.Boolean),
    sa.column("is_containment", sa.Boolean),
    sa.column("is_symmetric", sa.Boolean),
)
_nodes = sa.table(
    "nodes",
    sa.column("id", sa.String),
    sa.column("type", sa.String),
)


def _set_role(bind, key: str, role: str, *, present: bool) -> None:
    """Add or drop ``role`` on node type ``key`` (idempotent, JSON-array safe)."""
    row = bind.execute(sa.select(_node_types.c.roles).where(_node_types.c.key == key)).first()
    if row is None:
        return
    roles = list(row[0] or [])
    if present and role not in roles:
        roles.append(role)
    elif not present and role in roles:
        roles.remove(role)
    bind.execute(_node_types.update().where(_node_types.c.key == key).values(roles=roles or None))


def upgrade() -> None:
    bind = op.get_bind()
    # Reverse each project --part_of--> goal into goal --contains--> project, in place.
    rows = bind.execute(
        sa.select(_edges.c.id, _edges.c.source_id, _edges.c.target_id).where(_edges.c.rel_type == "part_of")
    ).all()
    for edge_id, source_id, target_id in rows:
        bind.execute(
            _edges.update()
            .where(_edges.c.id == edge_id)
            .values(source_id=target_id, target_id=source_id, rel_type="contains")
        )
    _set_role(bind, "goal", "container", present=True)
    bind.execute(_edge_types.delete().where(_edge_types.c.key == "part_of"))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.select(_edge_types.c.key).where(_edge_types.c.key == "part_of")).first() is None:
        bind.execute(
            _edge_types.insert().values(
                key="part_of", label="Part of", is_builtin=True, is_containment=False, is_symmetric=False
            )
        )
    _set_role(bind, "goal", "container", present=False)
    # Reverse goal --contains--> project links back to project --part_of--> goal.
    # Only edges from a goal to a project node are goal links; task children stay contains.
    goal_ids = {k for (k,) in bind.execute(sa.select(_nodes.c.id).where(_nodes.c.type == "goal")).all()}
    project_ids = {k for (k,) in bind.execute(sa.select(_nodes.c.id).where(_nodes.c.type == "project")).all()}
    rows = bind.execute(
        sa.select(_edges.c.id, _edges.c.source_id, _edges.c.target_id).where(_edges.c.rel_type == "contains")
    ).all()
    for edge_id, source_id, target_id in rows:
        if source_id in goal_ids and target_id in project_ids:
            bind.execute(
                _edges.update()
                .where(_edges.c.id == edge_id)
                .values(source_id=target_id, target_id=source_id, rel_type="part_of")
            )
