import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import backup as backup_service
from app.services.runtime_settings import get_system_settings

router = APIRouter(prefix="/backup", tags=["backup"])

_FILENAME_RE = re.compile(r"^shard-backup-\d{8}-\d{6}\.zip$")


@router.get("/status")
def backup_status(db: Session = Depends(get_db)):
    settings = get_system_settings(db)
    return {
        "enabled": bool(settings["backup_enabled"]),
        "hour": settings["backup_hour"],
        "keep": settings["backup_keep"],
        "backups": backup_service.list_backups(),
    }


@router.post("/run")
def run_backup(db: Session = Depends(get_db)):
    """Create a server-side backup archive now and apply retention."""
    path = backup_service.write_backup(db)
    settings = get_system_settings(db)
    backup_service.prune_backups(settings["backup_keep"])
    return {
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "backups": backup_service.list_backups(),
    }


@router.get("/export")
def export_backup(db: Session = Depends(get_db)):
    """Stream a freshly built backup archive as a download (nothing stored server-side)."""
    data, _meta = backup_service.build_archive(db)
    name = f"shard-backup-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/download/{filename}")
def download_backup(filename: str):
    """Download an existing server-side backup archive."""
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = backup_service.get_backup_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup not found")
    return FileResponse(path, media_type="application/zip", filename=filename)
