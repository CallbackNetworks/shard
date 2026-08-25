"""Full-data backup: every table serialized to JSON plus uploaded files,
packed into a single zip archive. Works across all supported database
backends because it reads through SQLAlchemy rather than copying DB files.
See ADR-0013.
"""

import io
import json
import logging
import os
import shutil
import zipfile
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import DateTime
from sqlalchemy.orm import Session

from app.database import Base
from app.services import attachment_admin

logger = logging.getLogger(__name__)

BACKUP_FORMAT_VERSION = 1
BACKUP_PREFIX = "shard-backup-"
# Same directory the attachment service writes to — imported rather than repeated, so
# pointing UPLOAD_DIR somewhere else cannot leave backups reading the old location.
UPLOAD_DIR = attachment_admin.UPLOAD_DIR


class RestoreError(Exception):
    """Raised when an archive is malformed or incompatible with the schema."""


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
    for path in files[max(keep, 1) :]:
        path.unlink(missing_ok=True)
        removed += 1
    if removed:
        logger.info("Pruned %d old backup(s), keeping %d", removed, keep)
    return removed


def _coerce_value(column, value):
    """Turn a JSON-decoded value back into the Python type the column expects.

    Only DateTime needs help: build_archive serializes datetimes to ISO strings,
    and psycopg will not accept a string into a timestamp column. Booleans and
    JSON survive the JSON round-trip as native types already.
    """
    if value is None:
        return None
    if isinstance(column.type, DateTime):
        return datetime.fromisoformat(value)
    return value


def _self_ref_columns(table):
    """Columns on `table` whose foreign key points back into the same table."""
    return [c for c in table.columns if any(fk.column.table is table for fk in c.foreign_keys)]


def _order_rows_for_insert(table, rows: list[dict]) -> list[dict]:
    """Order rows so a self-referential parent is always inserted before its child.

    Under enforced foreign keys (PostgreSQL, and MySQL) a child row whose parent
    lives in the same table — e.g. a subtask referencing tasks.parent_id — fails
    if inserted first. SQLite in this project does not enforce FKs, but ordering
    unconditionally keeps one code path across backends.
    """
    ref_cols = _self_ref_columns(table)
    if not ref_cols:
        return rows

    pk_cols = [c.name for c in table.primary_key.columns]
    if len(pk_cols) != 1:
        return rows
    pk = pk_cols[0]

    remaining = list(rows)
    emitted_ids: set = set()
    ordered: list[dict] = []
    # Iteratively emit rows whose self-referential parents are already placed.
    while remaining:
        progressed = False
        deferred = []
        for row in remaining:
            parents = [row.get(c.name) for c in ref_cols]
            if all(p is None or p in emitted_ids for p in parents):
                ordered.append(row)
                emitted_ids.add(row.get(pk))
                progressed = True
            else:
                deferred.append(row)
        if not progressed:
            # Dangling or cyclic references: emit the rest as-is rather than loop.
            ordered.extend(deferred)
            break
        remaining = deferred
    return ordered


def restore_db(db: Session, tables: dict) -> dict:
    """Replace all table contents with `tables` (destructive), FK-safe.

    Deletes every table in reverse dependency order, then re-inserts in forward
    order with self-referential rows sorted parent-first. Runs in one
    transaction so a failure leaves the existing data untouched.
    """
    known = {t.name: t for t in Base.metadata.sorted_tables}
    unknown = set(tables) - set(known)
    if unknown:
        raise RestoreError(f"Archive contains unknown tables: {sorted(unknown)}")

    counts: dict[str, int] = {}
    # Delete children before parents. ondelete=CASCADE covers self-referential
    # rows, so a single delete per table is enough.
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())

    for table in Base.metadata.sorted_tables:
        rows = tables.get(table.name, [])
        if not rows:
            counts[table.name] = 0
            continue
        cols = {c.name: c for c in table.columns}
        prepared = [
            {k: _coerce_value(cols[k], v) for k, v in row.items() if k in cols}
            for row in _order_rows_for_insert(table, rows)
        ]
        db.execute(table.insert(), prepared)
        counts[table.name] = len(prepared)

    db.commit()
    db.expire_all()
    logger.info("Restore complete: %d tables, %d rows", len(counts), sum(counts.values()))
    return counts


def restore_uploads(zf: zipfile.ZipFile, upload_dir: Path | None = None) -> int:
    """Replace the uploads directory with the archive's `uploads/` entries."""
    dest = upload_dir or UPLOAD_DIR
    members = [n for n in zf.namelist() if n.startswith("uploads/") and not n.endswith("/")]
    if not dest.parent.exists():
        # No uploads mount in this environment (e.g. tests): skip silently.
        return 0
    if dest.is_dir():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    dest_root = dest.resolve()
    written = 0
    for name in members:
        rel = name[len("uploads/") :]
        target = (dest / rel).resolve()
        # Guard against zip-slip: a crafted "uploads/../../x" entry must not
        # escape the uploads directory.
        if target != dest_root and dest_root not in target.parents:
            logger.warning("Skipping unsafe archive path during restore: %s", name)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(zf.read(name))
        written += 1
    return written


def restore_archive(db: Session, data: bytes, restore_files: bool = True) -> dict:
    """Validate and apply a backup archive built by build_archive."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise RestoreError("Not a valid zip archive") from exc

    with zf:
        names = zf.namelist()
        if "data.json" not in names:
            raise RestoreError("Archive is missing data.json")
        meta = {}
        if "meta.json" in names:
            meta = json.loads(zf.read("meta.json"))
            version = meta.get("format_version")
            if version != BACKUP_FORMAT_VERSION:
                raise RestoreError(f"Unsupported backup format_version {version!r}; expected {BACKUP_FORMAT_VERSION}")
        tables = json.loads(zf.read("data.json"))
        table_counts = restore_db(db, tables)
        file_count = restore_uploads(zf) if restore_files else 0

    return {
        "table_counts": table_counts,
        "files_restored": file_count,
        "source_meta": meta,
    }
