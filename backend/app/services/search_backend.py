"""Database-agnostic full-text search backend.

Provides FTS5 for SQLite, tsvector/tsquery for PostgreSQL,
and ILIKE fallback for MySQL and unknown dialects.
"""

import logging
from abc import ABC, abstractmethod

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.database import get_dialect

logger = logging.getLogger(__name__)


class SearchBackend(ABC):
    """Abstract interface for full-text search."""

    @abstractmethod
    def ensure_index(self, engine) -> None:
        """Create or maintain search indexes at startup."""

    @abstractmethod
    def search_tasks(
        self, db: Session, query: str, project_id: str | None, limit: int, offset: int
    ) -> tuple[list[str], bool]:
        """Search tasks and return (task_id_list, used_fts)."""


class SQLiteSearchBackend(SearchBackend):
    """SQLite FTS5 virtual table with triggers."""

    def ensure_index(self, engine) -> None:
        with engine.connect() as conn:
            existing_tables = set(inspect(engine).get_table_names())
            if "tasks_fts" not in existing_tables:
                conn.execute(text("CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id UNINDEXED, title, description)"))
                conn.execute(
                    text(
                        "INSERT INTO tasks_fts(task_id, title, description) "
                        "SELECT id, title, COALESCE(description, '') FROM tasks"
                    )
                )
            for trig in ("tasks_fts_insert", "tasks_fts_update", "tasks_fts_delete"):
                conn.execute(text(f"DROP TRIGGER IF EXISTS {trig}"))
            conn.execute(
                text(
                    "CREATE TRIGGER tasks_fts_insert AFTER INSERT ON tasks BEGIN "
                    "INSERT INTO tasks_fts(task_id, title, description) "
                    "VALUES (new.id, new.title, COALESCE(new.description, '')); END"
                )
            )
            conn.execute(
                text(
                    "CREATE TRIGGER tasks_fts_update AFTER UPDATE OF title, description ON tasks BEGIN "
                    "DELETE FROM tasks_fts WHERE task_id = old.id; "
                    "INSERT INTO tasks_fts(task_id, title, description) "
                    "VALUES (new.id, new.title, COALESCE(new.description, '')); END"
                )
            )
            conn.execute(
                text(
                    "CREATE TRIGGER tasks_fts_delete AFTER DELETE ON tasks BEGIN "
                    "DELETE FROM tasks_fts WHERE task_id = old.id; END"
                )
            )
            conn.commit()
        logger.info("SQLite FTS5 index initialized")

    def search_tasks(
        self, db: Session, query: str, project_id: str | None, limit: int, offset: int
    ) -> tuple[list[str], bool]:
        try:
            fts_query = text(
                "SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH :q ORDER BY rank LIMIT :lim OFFSET :off"
            )
            rows = db.execute(fts_query, {"q": query, "lim": limit, "off": offset}).fetchall()
            return [r[0] for r in rows], True
        except Exception:
            logger.debug("FTS5 query failed, falling back to ILIKE")
            return [], False


class PostgresSearchBackend(SearchBackend):
    """PostgreSQL tsvector/tsquery with GIN index."""

    def ensure_index(self, engine) -> None:
        with engine.connect() as conn:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_tasks_fts "
                    "ON tasks USING gin("
                    "to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, ''))"
                    ")"
                )
            )
            conn.commit()
        logger.info("PostgreSQL GIN index initialized")

    def search_tasks(
        self, db: Session, query: str, project_id: str | None, limit: int, offset: int
    ) -> tuple[list[str], bool]:
        try:
            fts_query = text(
                "SELECT id FROM tasks "
                "WHERE to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')) "
                "@@ plainto_tsquery('english', :q) "
                "ORDER BY ts_rank("
                "to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(description, '')), "
                "plainto_tsquery('english', :q)"
                ") DESC "
                "LIMIT :lim OFFSET :off"
            )
            rows = db.execute(fts_query, {"q": query, "lim": limit, "off": offset}).fetchall()
            return [r[0] for r in rows], True
        except Exception:
            logger.debug("PostgreSQL tsquery failed, falling back to ILIKE")
            return [], False


class FallbackSearchBackend(SearchBackend):
    """ILIKE fallback for MySQL and unknown dialects."""

    def ensure_index(self, engine) -> None:
        logger.info("Using ILIKE fallback search (no FTS index)")

    def search_tasks(
        self, db: Session, query: str, project_id: str | None, limit: int, offset: int
    ) -> tuple[list[str], bool]:
        return [], False


def get_search_backend() -> SearchBackend:
    """Return the appropriate search backend for the current database dialect."""
    dialect = get_dialect()
    if dialect == "sqlite":
        return SQLiteSearchBackend()
    if dialect == "postgresql":
        return PostgresSearchBackend()
    return FallbackSearchBackend()
