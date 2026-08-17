"""give the identity type the container role

ADR-0095. ADR-0040 declared ``identity`` as ``{shareable, subscribable}`` — a persona you
hang ownership on, never a place work lives — and gave the container role to
``organization`` instead. Production disagreed: the user's hierarchy is
``organization -> identity -> project`` stored as ``contains`` edges, six of which the
ADR-0078 endpoint rule would now refuse to create. The structure worked (Focus walks both
relations) but could not be rebuilt, so every new project had to be attached a second way.

``seed_builtin_types`` only inserts *missing* types and never overwrites, so editing the
seed alone leaves every existing database — production included — on the old declaration.

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c1e3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5a7b9d1f4"
down_revision: str | None = "b2d4f6a8c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE = "container"


def _set_identity_roles(add: bool) -> None:
    """Add or remove ``container`` from the identity type, leaving its other roles alone."""
    node_types = sa.table("node_types", sa.column("key", sa.String), sa.column("roles", sa.JSON))
    conn = op.get_bind()
    row = conn.execute(sa.select(node_types.c.roles).where(node_types.c.key == "identity")).first()
    if row is None:
        return  # a database without the built-in type gets it from the seed, already correct
    roles = list(row[0] or [])
    if add and ROLE not in roles:
        roles.insert(0, ROLE)
    elif not add and ROLE in roles:
        roles.remove(ROLE)
    else:
        return
    conn.execute(node_types.update().where(node_types.c.key == "identity").values(roles=roles))


def upgrade() -> None:
    _set_identity_roles(add=True)


def downgrade() -> None:
    # Reversible as a declaration, but any identity -> project ``contains`` edge created
    # while the role was held becomes one the endpoint rule refuses. Those edges are left
    # in place: they are the user's structure, and this migration does not own them.
    _set_identity_roles(add=False)
