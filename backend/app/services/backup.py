"""Full-data backup: every table serialized to JSON plus uploaded files,
packed into a single zip archive. Works across all supported database
backends because it reads through SQLAlchemy rather than copying DB files.
See ADR-0013.
"""

import io
import json
import logging
import os
import zipfile
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy.orm import Session

from app.database import Base

logger = logging.getLogger(__name__)

BACKUP_FORMAT_VERSION = 1
BACKUP_PREFIX = "shard-backup-"
UPLOAD_DIR = Path("/app/uploads")


def get_backup_dir() -> Path:
    # Default lives inside /app/data, which both dev and prod compose files
    # already bind-mount to the host, so archives survive container rebuilds.
    return Path(os.getenv("BACKUP_DIR", "/app/data/backups"))


def _json_safe(value):
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def serialize_db(db: Session) -> dict:
    """Dump every table registered on the ORM metadata to plain dicts.

    Iterating metadata (instead of listing models by hand) means new tables
    are included in backups automatically.
    """
    tables = {}
    for table in Base.metadata.sorted_tables:
        rows = db.execute(table.select()).mappings().all()
        tables[table.name] = [{k: _json_safe(v) for k, v in row.items()} for row in rows]
    return tables


def build_archive(db: Session) -> tuple[bytes, dict]:
    """Build the zip archive in memory; returns (bytes, meta)."""
    tables = serialize_db(db)
    meta = {
        "format_version": BACKUP_FORMAT_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "table_counts": {name: len(rows) for name, rows in tables.items()},
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", json.dumps(meta, indent=2))
        zf.writestr("data.json", json.dumps(tables, ensure_ascii=False))
        if UPLOAD_DIR.is_dir():
            for path in sorted(UPLOAD_DIR.rglob("*")):
                if path.is_file():
                    zf.write(path, f"uploads/{path.relative_to(UPLOAD_DIR)}")
    return buf.getvalue(), meta


def write_backup(db: Session, dest_dir: Path | None = None) -> Path:
    """Create a timestamped backup archive on disk and return its path."""
    dest = dest_dir or get_backup_dir()
    dest.mkdir(parents=True, exist_ok=True)
    data, _meta = build_archive(db)
    name = f"{BACKUP_PREFIX}{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.zip"
    path = dest / name
    path.write_bytes(data)
    logger.info("Backup written: %s (%d bytes)", path, len(data))
    return path


def list_backups(dest_dir: Path | None = None) -> list[dict]:
    """Existing backup archives, newest first."""
    dest = dest_dir or get_backup_dir()
    if not dest.is_dir():
        return []
    files = sorted(dest.glob(f"{BACKUP_PREFIX}*.zip"), key=lambda p: p.name, reverse=True)
    return [
        {
            "filename": p.name,
            "size_bytes": p.stat().st_size,
            "created_at": datetime.fromtimestamp(p.stat().st_mtime, tz=UTC).isoformat(),
        }
        for p in files
    ]


def prune_backups(keep: int, dest_dir: Path | None = None) -> int:
    """Delete the oldest archives beyond `keep`; returns how many were removed."""
    dest = dest_dir or get_backup_dir()
    if not dest.is_dir():
        return 0
    files = sorted(dest.glob(f"{BACKUP_PREFIX}*.zip"), key=lambda p: p.name, reverse=True)
    removed = 0
    for path in files[max(keep, 1):]:
        path.unlink(missing_ok=True)
        removed += 1
    if removed:
        logger.info("Pruned %d old backup(s), keeping %d", removed, keep)
    return removed
