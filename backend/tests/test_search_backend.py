"""The search backend is the only raw-SQL module in the codebase, and it had no test.

Everything else reaches the database through SQLAlchemy, where a wrong column name is a
Python error. Here the statements are strings: the FTS5 triggers, the tsvector index and
the JSON extraction are all text the ORM never checks. ADR-0033 moved a task's
``description`` into the node's JSON ``data`` bag, and the three trigger bodies below each
read it out again by hand — three places for one rename to break, none of which the type
system sees.

The other half is the fallback contract. ``search_tasks`` returns ``(ids, used_fts)`` and
the router falls back to ``ILIKE`` when the second value is False. That flag is how a
failed FTS query stays invisible to the caller, so the tests pin both the flag *and* the
rollback that makes the fallback query possible at all — on PostgreSQL a failed statement
aborts the transaction, and without the rollback the fallback fails too.
"""

import pytest
from sqlalchemy import text

from app.services.search_backend import (
    FallbackSearchBackend,
    PostgresSearchBackend,
    SQLiteSearchBackend,
    get_search_backend,
)
from tests.factories import make_project, make_task


def _sqlite_only(db):
    if db.bind.dialect.name != "sqlite":
        pytest.skip("SQLite-specific: FTS5 virtual tables and triggers")


@pytest.fixture()
def project(db):
    p = make_project(db, name="Search Project")
    db.commit()
    return p


class TestBackendSelection:
    """One dialect, one backend — the dispatch nothing else re-decides."""

    def test_sqlite(self):
        assert isinstance(get_search_backend("sqlite"), SQLiteSearchBackend)

    def test_postgresql(self):
        assert isinstance(get_search_backend("postgresql"), PostgresSearchBackend)

    @pytest.mark.parametrize("dialect", ["mysql", "oracle", "duckdb"])
    def test_anything_else_falls_back(self, dialect):
        assert isinstance(get_search_backend(dialect), FallbackSearchBackend)

    def test_no_argument_reads_the_configured_dialect(self):
        assert get_search_backend() is not None

    def test_an_empty_dialect_means_configured_not_fallback(self):
        """`dialect or get_dialect()` — an empty string is falsy, so it defers rather
        than falling back. Worth pinning: the two readings differ by a whole backend."""
        assert type(get_search_backend("")) is type(get_search_backend())


class TestSQLiteIndex:
    """The FTS index has to track task nodes through their whole lifecycle."""

    def test_a_task_created_after_the_index_is_findable(self, db, project):
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)

        task = make_task(db, project_id=project.id, title="Reticulating splines")
        db.add(task)
        db.commit()

        ids, used_fts = backend.search_tasks(db, "splines", None, 10, 0)
        assert used_fts is True
        assert task.id in ids

    def test_a_task_that_existed_before_the_index_is_findable(self, db, project):
        """ensure_index backfills; without that, everything older than the index is invisible."""
        _sqlite_only(db)
        task = make_task(db, project_id=project.id, title="Predates the index")
        db.add(task)
        db.commit()

        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)

        ids, used_fts = backend.search_tasks(db, "Predates", None, 10, 0)
        assert used_fts is True
        assert task.id in ids

    def test_a_renamed_task_is_found_by_its_new_title_only(self, db, project):
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Original wording")
        db.add(task)
        db.commit()

        task.title = "Replacement wording"
        db.commit()

        by_new, _ = backend.search_tasks(db, "Replacement", None, 10, 0)
        by_old, _ = backend.search_tasks(db, "Original", None, 10, 0)
        assert task.id in by_new
        assert task.id not in by_old, "the update trigger left the old title in the index"

    def test_a_deleted_task_leaves_the_index(self, db, project):
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Ephemeral entry")
        db.add(task)
        db.commit()
        task_id = task.id

        db.delete(task)
        db.commit()

        ids, _ = backend.search_tasks(db, "Ephemeral", None, 10, 0)
        assert task_id not in ids, "the delete trigger left a dangling row in the index"

    def test_the_description_is_indexed_from_the_json_bag(self, db, project):
        """ADR-0033 put description in `data`; three trigger bodies read it out by hand."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Opaque title")
        task.data = {**(task.data or {}), "description": "quokka sightings"}
        db.add(task)
        db.commit()

        ids, used_fts = backend.search_tasks(db, "quokka", None, 10, 0)
        assert used_fts is True
        assert task.id in ids

    def test_a_task_with_no_description_still_indexes(self, db, project):
        """COALESCE over a missing JSON key — a NULL there would drop the row entirely."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Bare minimum")
        task.data = {}
        db.add(task)
        db.commit()

        ids, _ = backend.search_tasks(db, "minimum", None, 10, 0)
        assert task.id in ids

    def test_only_task_nodes_are_indexed(self, db, project):
        """The triggers are guarded by `type = 'task'`; a project must not appear."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        other = make_project(db, name="Distinctive Container Name")
        db.commit()

        ids, _ = backend.search_tasks(db, "Distinctive", None, 10, 0)
        assert other.id not in ids

    def test_ensure_index_is_idempotent(self, db, project):
        """It runs on every startup, and it drops and recreates its own triggers."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Survives reindexing")
        db.add(task)
        db.commit()

        backend.ensure_index(db.bind)
        backend.ensure_index(db.bind)

        ids, used_fts = backend.search_tasks(db, "Survives", None, 10, 0)
        assert used_fts is True
        assert ids.count(task.id) == 1, "re-running the index duplicated the row"

    def test_limit_and_offset_page_the_results(self, db, project):
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        for i in range(5):
            db.add(make_task(db, project_id=project.id, title=f"Paginated candidate {i}"))
        db.commit()

        first, _ = backend.search_tasks(db, "Paginated", None, 2, 0)
        second, _ = backend.search_tasks(db, "Paginated", None, 2, 2)
        assert len(first) == 2
        assert len(second) == 2
        assert not set(first) & set(second)


class TestTheFallbackContract:
    """`used_fts=False` is how the router learns to run its own ILIKE query."""

    def test_the_fallback_backend_never_claims_fts(self, db):
        ids, used_fts = FallbackSearchBackend().search_tasks(db, "anything", None, 10, 0)
        assert (ids, used_fts) == ([], False)

    def test_the_fallback_backend_builds_no_index(self, db):
        FallbackSearchBackend().ensure_index(db.bind)  # must not raise

    def test_a_broken_query_reports_false_rather_than_raising(self, db, project):
        """A malformed FTS expression is a user typing, not an outage."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)

        ids, used_fts = backend.search_tasks(db, 'unbalanced "quote AND', None, 10, 0)
        assert (ids, used_fts) == ([], False)

    def test_the_session_survives_a_failed_query(self, db, project):
        """The rollback is what makes the fallback possible; without it the next query dies too."""
        _sqlite_only(db)
        backend = SQLiteSearchBackend()
        backend.ensure_index(db.bind)
        task = make_task(db, project_id=project.id, title="Still reachable")
        db.add(task)
        db.commit()

        backend.search_tasks(db, 'unbalanced "quote AND', None, 10, 0)

        # The exact thing the router does next.
        rows = db.execute(text("SELECT id FROM nodes WHERE title LIKE :q"), {"q": "%Still reachable%"}).fetchall()
        assert [r[0] for r in rows] == [task.id]

    def test_searching_before_the_index_exists_does_not_raise(self, db):
        """First boot: the query runs before ensure_index on a fresh database."""
        _sqlite_only(db)
        db.execute(text("DROP TABLE IF EXISTS tasks_fts"))
        db.commit()

        ids, used_fts = SQLiteSearchBackend().search_tasks(db, "anything", None, 10, 0)
        assert (ids, used_fts) == ([], False)
