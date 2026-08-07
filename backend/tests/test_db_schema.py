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
