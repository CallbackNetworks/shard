"""How a database reaches the schema the running code expects.

Two situations occur and they need opposite treatment, which is why the decision lives
in one module rather than being split between the application and the deploy pipeline:

* A database that does not exist yet is built by ``create_all()`` — already at the
  latest schema — and then *stamped* to head. Replaying the chain instead would be
  wrong: the root revision is a no-op baseline that assumes the schema already exists,
  so every later ``ALTER TABLE`` would run against tables no migration ever created.
* A database that already exists is behind by however many revisions have landed since
  it was last touched, and has to be *upgraded*.

The application performs only the first. Under ``uvicorn --workers N`` the lifespan runs
once per worker, and two workers upgrading the same database concurrently would read the
same starting revision and apply the same migrations twice. ``create_all()`` and ``stamp``
survive that; ``upgrade`` does not. So the upgrade is a deploy step — ``python -m
app.db_schema``, run once before any worker starts — which fails the deploy loudly
instead of leaving a half-migrated database serving traffic.

Until this module existed the upgrade had no home at all: not in the workflow, not in an
entrypoint, not in the lifespan. Production carried the schema it was first created with
across every deploy and picked up only whatever tables ``create_all()`` happened to add —
never a column, never a data backfill. See ADR-0064.
"""

import logging
import sys
from pathlib import Path

from sqlalchemy import inspect as sa_inspect

logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# The table whose presence means "this database has a schema". It has to be one the
# current models actually declare, which is what `test_marker_table_belongs_to_the_real
# _schema` checks: the probe this replaced asked for `tasks`, a table the graph migration
# had collapsed into `nodes` (ADR-0032), so it answered "no schema" for every database
# that has ever existed. Harmless where it sat — the stamp it guarded was gated on a
# second condition — but read as "is this database new?" it would have had the deploy
# step skip the upgrade on precisely the databases that need one.
SCHEMA_MARKER_TABLE = "nodes"
VERSION_TABLE = "alembic_version"

FRESH = "fresh"
MANAGED = "managed"
UNTRACKED = "untracked"


def schema_state(engine) -> str:
    """Which of the three situations this database is in.

    ``UNTRACKED`` is the one that needs a human: the tables are there, so it is not new,
    but nothing records which migrations they have already had, so neither stamping nor
    upgrading can be chosen without guessing.
    """
    inspector = sa_inspect(engine)
    if not inspector.has_table(SCHEMA_MARKER_TABLE):
        return FRESH
    return MANAGED if inspector.has_table(VERSION_TABLE) else UNTRACKED


def _alembic_config():
    from alembic.config import Config as AlembicConfig

    cfg = AlembicConfig(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    return cfg


def stamp_head() -> None:
    """Record a freshly created schema as already at head."""
    from alembic import command as alembic_command

    alembic_command.stamp(_alembic_config(), "head")


def upgrade_head() -> None:
    """Apply every revision this database has not had yet."""
    from alembic import command as alembic_command

    alembic_command.upgrade(_alembic_config(), "head")


def current_revision(engine) -> str | None:
    from alembic.runtime.migration import MigrationContext

    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def main(engine=None) -> int:
    if engine is None:
        from app.database import engine as default_engine

        engine = default_engine

    state = schema_state(engine)

    if state == FRESH:
        print("No schema yet — the application creates and stamps it on first boot.")
        return 0

    if state == UNTRACKED:
        print(
            f"This database has tables but no {VERSION_TABLE} table, so there is no record of "
            "which migrations it has already had. Refusing to guess — stamp it at the revision "
            "its schema actually matches, then deploy again.",
            file=sys.stderr,
        )
        return 1

    before = current_revision(engine)
    print(f"Schema at {before or 'unknown'} — upgrading to head.")
    upgrade_head()
    print(f"Schema now at {current_revision(engine)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
