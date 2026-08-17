"""Backup and restore, for every door that runs one (ADR-0091).

``services/backup`` knows how to build an archive and put one back. What it never had was a
caller other than the Settings page, so in production the entire disaster-recovery surface —
take a backup, list what exists, put one back — was reachable only by a person in a browser
(ADR-0085). That is the wrong way round for this capability in particular: taking a snapshot
before a risky change is the most obviously *automatable* act in the system, and the agent
about to make the risky change is the one that knows a snapshot is warranted.

Restore stays deliberately awkward. It replaces everything, so it demands ``confirm="replace"``
at both doors and ``admin`` at the agent one, and the guard lives here so a third door cannot
be written without it. The awkwardness is the feature: this is the only call in the system
whose mistake cannot be undone by making another call.

Filenames are validated against a pattern rather than joined and hoped for. ``get_backup_dir()
/ filename`` with ``filename="../../etc/passwd"`` resolves outside the directory, and the
internal router got that right — but "the internal router got it right" is exactly the state
ADR-0070 warns about, since the second door is written by whoever writes it next.
"""

import re
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.services import backup as backup_service
from app.services.errors import Invalid, NotFound, Unprocessable
from app.services.runtime_settings import get_system_settings

# A name this system minted itself: ``shard-backup-YYYYMMDD-HHMMSS.zip`` and nothing else.
_FILENAME_RE = re.compile(r"^shard-backup-\d{8}-\d{6}\.zip$")

_CONFIRM = "replace"


def status(db: Session) -> dict:
    """Whether the daily backup is on, when it runs, how many are kept, and what exists."""
    settings = get_system_settings(db)
    return {
        "enabled": bool(settings["backup_enabled"]),
        "hour": settings["backup_hour"],
        "keep": settings["backup_keep"],
        "backups": backup_service.list_backups(),
    }


def run(db: Session) -> dict:
    """Write a backup archive to the server now and apply retention."""
    path = backup_service.write_backup(db)
    backup_service.prune_backups(get_system_settings(db)["backup_keep"])
    return {
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "backups": backup_service.list_backups(),
    }


def export(db: Session) -> tuple[bytes, str]:
    """Build an archive in memory and hand it back — nothing is stored server-side."""
    data, _meta = backup_service.build_archive(db)
    return data, f"shard-backup-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.zip"


def archive_path(filename: str) -> Path:
    """An existing server-side archive, or the refusal."""
    if not _FILENAME_RE.match(filename):
        raise Invalid("invalid backup filename")
    path = backup_service.get_backup_dir() / filename
    if not path.is_file():
        raise NotFound("backup not found")
    return path


def _check_confirm(confirm: str) -> None:
    if confirm != _CONFIRM:
        raise Invalid(f'restore requires confirm="{_CONFIRM}"')


def restore_bytes(db: Session, data: bytes, *, confirm: str) -> dict:
    """Replace ALL data with the contents of an archive.

    One transaction, so a malformed archive leaves the live data untouched — which is why a
    bad archive is a 422 (the payload cannot be what it claims) rather than a 500.
    """
    _check_confirm(confirm)
    try:
        return backup_service.restore_archive(db, data)
    except backup_service.RestoreError as exc:
        raise Unprocessable(str(exc)) from exc


def restore_file(db: Session, filename: str, *, confirm: str) -> dict:
    """Replace ALL data with the contents of an archive already on the server."""
    _check_confirm(confirm)
    path = archive_path(filename)
    return restore_bytes(db, path.read_bytes(), confirm=confirm)
