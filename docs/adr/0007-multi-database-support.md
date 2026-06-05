# ADR-0007: Multi-Database Support

## Status

Accepted

## Date

2026-06-05

## Context

The application currently hardcodes SQLite as the only database backend. While SQLite is ideal for single-user local deployments (zero-config, file-based, no extra services), users who want to run the platform on cloud infrastructure or handle higher concurrency need support for managed database services such as AWS RDS (PostgreSQL/MySQL), Azure Database, or Google Cloud SQL.

Key technical constraints:

- The codebase uses SQLAlchemy ORM throughout, which provides dialect abstraction for most operations.
- However, several features rely on SQLite-specific functionality: FTS5 virtual tables for full-text search, PRAGMA statements for connection tuning, and batch mode for Alembic migrations.
- JSON columns (used in ~16 models) are already cross-database compatible via SQLAlchemy's `JSON` type.
- The `ilike()` operator used in search queries compiles correctly across all three target databases.

## Decision

We will support three database backends — **SQLite** (default), **PostgreSQL** (primary cloud target), and **MySQL** (secondary) — using the following strategies:

1. **Dialect-aware engine factory** (`database.py`): A `_create_engine(url)` function detects the database dialect from the `DATABASE_URL` scheme and applies appropriate connection arguments (e.g., `check_same_thread` for SQLite, `pool_pre_ping` for PostgreSQL/MySQL), pool settings, and event listeners (PRAGMAs for SQLite only). A `get_dialect()` helper is exported for use by other modules.

2. **Strategy pattern for full-text search** (`services/search_backend.py`): Three implementations behind a common interface:
   - `SQLiteSearchBackend` — FTS5 virtual table with triggers (existing behavior)
   - `PostgresSearchBackend` — GIN index with `tsvector`/`tsquery`
   - `FallbackSearchBackend` — `ILIKE` pattern matching (MySQL and unknown dialects)

3. **Conditional Alembic batch mode** (`migrations/env.py`): `render_as_batch` is set to `True` only when the target database is SQLite. This is an optimization — batch mode is harmless but slower on PostgreSQL/MySQL.

4. **Docker Compose profiles**: Optional `postgres` and `mysql` profiles provide database containers for development. SQLite remains the default with no extra services required.

5. **Cloud connectivity**: The engine factory supports `DB_SSL_MODE` for TLS connections to managed databases, and normalizes `postgres://` URLs to `postgresql://` for compatibility with providers like Heroku.

We chose PostgreSQL as the primary cloud target because of its native full-text search capabilities (`tsvector`/`tsquery` with GIN indexes), JSONB support, and wide availability on managed cloud platforms. MySQL receives a simpler ILIKE-based search fallback, which can be enhanced with FULLTEXT indexes in the future.

## Consequences

**Positive:**
- Users can deploy on any infrastructure — local SQLite, self-hosted PostgreSQL/MySQL, or cloud-managed databases.
- SQLite remains the zero-config default; no breaking changes for existing deployments.
- PostgreSQL deployments get native full-text search with relevance ranking via `ts_rank`.
- Connection pooling is properly tuned per dialect (pool_pre_ping for network databases, PRAGMAs for SQLite).

**Negative:**
- Two existing migrations (`925c7e57b28a`, `456b53078436`) need minimal patches to replace SQLite-specific `PRAGMA table_info()` and raw SQL index creation with cross-database alternatives.
- MySQL full-text search is limited to ILIKE fallback (no relevance ranking); this is acceptable for the secondary-support tier.
- The test suite needs a `TEST_DATABASE_URL` environment variable to run against non-SQLite databases, adding CI complexity.
- Two additional Python packages (`psycopg`, `pymysql`) are added to the Docker image even when unused.
