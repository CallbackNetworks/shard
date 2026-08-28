"""The deploy-time half of the schema decision (ADR-0064).

The case worth pinning is the one with no symptom until the first deploy of a new
environment: running ``upgrade`` against a database that does not exist yet replays a
chain whose root is a no-op baseline, so every later ``ALTER TABLE`` runs against tables
nothing has created. ``main`` has to recognise that database and leave it alone.

The table names below are written out rather than read from the module's own constants.
A test that asked the module which table it probes for would keep passing if the probe
were pointed at a table the real schema does not have — which is not hypothetical: the
probe this module replaced looked for `tasks`, gone since the graph migration, and so
called every existing database new.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, text

from app import db_schema


def _engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'probe.db'}")


def _create_schema(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE nodes (id TEXT PRIMARY KEY)"))


def _create_version_table(engine, revision):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:r)"), {"r": revision})


def _no_migrations(monkeypatch):
    """Record what ``main`` would have run, without running it."""
    calls = []
    monkeypatch.setattr(db_schema, "upgrade_head", lambda: calls.append("upgrade"))
    monkeypatch.setattr(db_schema, "stamp_head", lambda: calls.append("stamp"))
    return calls


def test_marker_table_belongs_to_the_real_schema():
    """The probe only means anything if create_all() actually builds this table."""
    from app.models import Base

    assert db_schema.SCHEMA_MARKER_TABLE in Base.metadata.tables


def test_empty_database_is_fresh(tmp_path):
    assert db_schema.schema_state(_engine(tmp_path)) == db_schema.FRESH


def test_schema_with_a_version_table_is_managed(tmp_path):
    engine = _engine(tmp_path)
    _create_schema(engine)
    _create_version_table(engine, "d4f6a8c0e2b3")
    assert db_schema.schema_state(engine) == db_schema.MANAGED


def test_schema_without_a_version_table_is_untracked(tmp_path):
    engine = _engine(tmp_path)
    _create_schema(engine)
    assert db_schema.schema_state(engine) == db_schema.UNTRACKED


def test_fresh_database_is_left_for_the_application_to_create(tmp_path, monkeypatch):
    calls = _no_migrations(monkeypatch)
    assert db_schema.main(_engine(tmp_path)) == 0
    assert calls == []


def test_untracked_database_refuses_instead_of_guessing(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    _create_schema(engine)
    calls = _no_migrations(monkeypatch)
    assert db_schema.main(engine) == 1
    assert calls == []


def test_existing_schema_is_upgraded(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    _create_schema(engine)
    _create_version_table(engine, "d4f6a8c0e2b3")
    calls = _no_migrations(monkeypatch)
    assert db_schema.main(engine) == 0
    assert calls == ["upgrade"]


def test_current_revision_reads_what_the_database_records(tmp_path):
    engine = _engine(tmp_path)
    _create_schema(engine)
    _create_version_table(engine, "c2e4a6b8d0f1")
    assert db_schema.current_revision(engine) == "c2e4a6b8d0f1"


class TestAMigrationRunsAgainstTheStrictSchema:
    """A revision has to survive the schema ``create_all`` builds, not just the local one.

    ADR-0118's revision inserted two ``edge_types`` rows without ``is_symmetric``. A Core
    insert runs no ORM-level default, so the value went in as NULL — which the developer's
    own database accepted, because its ``edge_types`` was created by an old revision where
    the column was nullable, and which production refused with ``NOT NULL constraint
    failed``. Every test passed, both database targets passed, and the deploy died on the
    migration step.

    The asymmetry is the whole point: a migration is exercised locally against whatever
    shape history left behind, and in production against a different one. ``create_all``
    builds the strictest version — every ``nullable=False`` the models declare — so
    running the chain against it is the closest a test gets to the target that matters.
    """

    def _fresh_strict_db(self, tmp_path):
        """A database with today's tables and yesterday's alembic version."""
        from app.models import Base

        engine = create_engine(f"sqlite:///{tmp_path / 'strict.db'}")
        Base.metadata.create_all(engine)
        return engine

    def _upgrade(self, engine, revision, monkeypatch):
        from alembic import command
        from alembic.config import Config

        # ``migrations/env.py`` lets ``DATABASE_URL`` win over ``sqlalchemy.url``, so
        # without this the upgrade would run against the container's real database —
        # which is already at head, so it would quietly do nothing and the test would
        # assert against a database the migration never touched.
        monkeypatch.setenv("DATABASE_URL", str(engine.url))
        cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", str(engine.url))
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM alembic_version"))
            conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:r)"), {"r": revision})
        command.upgrade(cfg, "head")

    def test_a_stale_builtin_declaration_is_brought_back_in_line(self, tmp_path, monkeypatch):
        """The half `seed_builtin_types` cannot do (ADR-0078, b5d7f9a1c3e6).

        Production's `contains` description said "an identity cannot be a parent here"
        long after ADR-0095 made that false, because the seed only inserts what is
        missing. A database holding yesterday's sentence has to come out of `upgrade`
        holding today's.
        """
        from app.services.graph_registry import BUILTIN_EDGE_TYPES, BUILTIN_NODE_TYPES

        engine = self._fresh_strict_db(tmp_path)
        now = datetime.now(UTC)
        stale = "an identity cannot be a parent here"
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
            conn.execute(
                text(
                    "INSERT INTO edge_types "
                    "(key, label, description, is_builtin, is_containment, is_symmetric, created_at, updated_at) "
                    "VALUES ('contains', 'Contains', :d, 1, 1, 0, :t, :t)"
                ),
                {"d": stale, "t": now},
            )
            conn.execute(
                text(
                    "INSERT INTO node_types (key, label, is_builtin, fields, created_at, updated_at) "
                    "VALUES ('project', 'Project', 1, '[]', :t, :t)"
                ),
                {"t": now},
            )
            # A custom type with its own declarations, which the resync must not touch.
            conn.execute(
                text(
                    "INSERT INTO node_types (key, label, is_builtin, fields, created_at, updated_at) "
                    "VALUES ('topic', 'Topic', 0, :f, :t, :t)"
                ),
                {"f": '[{"key": "mine", "label": "Mine", "kind": "text"}]', "t": now},
            )

        self._upgrade(engine, "d601757ef2ef", monkeypatch)

        want_edge = next(s for s in BUILTIN_EDGE_TYPES if s["key"] == "contains")["description"]
        want_node = next(s for s in BUILTIN_NODE_TYPES if s["key"] == "project")["fields"]
        with engine.begin() as conn:
            got = conn.execute(text("SELECT description FROM edge_types WHERE key='contains'")).scalar()
            assert got == want_edge
            assert stale not in got
            fields = json.loads(conn.execute(text("SELECT fields FROM node_types WHERE key='project'")).scalar())
            assert [f["key"] for f in fields] == [f["key"] for f in want_node]
            # The user's own type is left exactly as it was.
            custom = json.loads(conn.execute(text("SELECT fields FROM node_types WHERE key='topic'")).scalar())
            assert [f["key"] for f in custom] == ["mine"]

    def test_the_decision_revision_applies_to_a_create_all_schema(self, tmp_path, monkeypatch):
        engine = self._fresh_strict_db(tmp_path)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)"))
            # A label-shaped decision record, the row this revision exists to move.
            conn.execute(
                text(
                    "INSERT INTO nodes (id, type, title, position, is_pinned, created_at, updated_at, data) "
                    "VALUES ('d1', 'label', 'Use PG', 0, 0, :t, :t, :d)"
                ),
                {"t": datetime.now(UTC), "d": '{"type": "decision", "color": "#818cf8"}'},
            )

        self._upgrade(engine, "d601757ef2ef", monkeypatch)

        with engine.begin() as conn:
            assert conn.execute(text("SELECT type FROM nodes WHERE id='d1'")).scalar() == "decision"
            # The columns an ORM default would have filled, which a Core insert does not.
            row = conn.execute(
                text("SELECT is_symmetric, is_containment, is_builtin, created_at FROM edge_types WHERE key='governs'")
            ).one()
            assert row[0] == 0 and row[1] == 0 and row[2] == 1 and row[3] is not None
            assert conn.execute(text("SELECT created_at FROM node_types WHERE key='decision'")).scalar() is not None
