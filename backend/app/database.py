import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./shard.db")


def get_dialect(url: str | None = None) -> str:
    """Return the database dialect name: 'sqlite', 'postgresql', or 'mysql'."""
    u = url or DATABASE_URL
    if u.startswith("sqlite"):
        return "sqlite"
    if u.startswith("postgresql") or u.startswith("postgres"):
        return "postgresql"
    if u.startswith("mysql"):
        return "mysql"
    raise ValueError(f"Unsupported database URL scheme: {u}")


def _create_engine(url: str):
    # Normalize Heroku-style postgres:// to postgresql://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    dialect = get_dialect(url)
    kwargs = {}

    if dialect == "sqlite":
        kwargs["connect_args"] = {"check_same_thread": False}
    elif dialect == "postgresql":
        kwargs["pool_size"] = int(os.environ.get("DB_POOL_SIZE", "5"))
        kwargs["max_overflow"] = int(os.environ.get("DB_MAX_OVERFLOW", "10"))
        kwargs["pool_timeout"] = int(os.environ.get("DB_POOL_TIMEOUT", "30"))
        kwargs["pool_pre_ping"] = True
        kwargs["pool_recycle"] = 1800
        ssl_mode = os.environ.get("DB_SSL_MODE")
        if ssl_mode:
            kwargs.setdefault("connect_args", {})["sslmode"] = ssl_mode
    elif dialect == "mysql":
        kwargs["pool_size"] = int(os.environ.get("DB_POOL_SIZE", "5"))
        kwargs["max_overflow"] = int(os.environ.get("DB_MAX_OVERFLOW", "10"))
        kwargs["pool_timeout"] = int(os.environ.get("DB_POOL_TIMEOUT", "30"))
        kwargs["pool_pre_ping"] = True
        kwargs["pool_recycle"] = 1800
        kwargs["connect_args"] = {"charset": "utf8mb4"}

    eng = create_engine(url, **kwargs)

    if dialect == "sqlite":

        @event.listens_for(eng, "connect")
        def _set_sqlite_pragmas(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

    return eng


engine = _create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
