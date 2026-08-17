"""Internal backup surface. The acts live in ``services/backup_admin`` (ADR-0091),
so ``/api/v1/backup/*`` is the same capability through the other door, not a second
implementation of it."""

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import backup_admin

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("/status")
def backup_status(db: Session = Depends(get_db)):
    return backup_admin.status(db)


@router.post("/run")
def run_backup(db: Session = Depends(get_db)):
    """Create a server-side backup archive now and apply retention."""
    return backup_admin.run(db)


@router.get("/export")
def export_backup(db: Session = Depends(get_db)):
    """Stream a freshly built backup archive as a download (nothing stored server-side)."""
    data, name = backup_admin.export(db)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/download/{filename}")
def download_backup(filename: str):
    """Download an existing server-side backup archive."""
    path = backup_admin.archive_path(filename)
    return FileResponse(path, media_type="application/zip", filename=filename)


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    confirm: str = Form(""),
    db: Session = Depends(get_db),
):
    """Replace ALL data with the contents of an uploaded backup archive.

    Destructive: requires confirm="replace" to guard against accidents. The
    whole restore runs in one transaction, so a malformed archive leaves the
    live data untouched.
    """
    return backup_admin.restore_bytes(db, await file.read(), confirm=confirm)


@router.post("/restore/{filename}")
def restore_from_server(filename: str, confirm: str = Form(""), db: Session = Depends(get_db)):
    """Restore from an existing server-side archive by filename."""
    return backup_admin.restore_file(db, filename, confirm=confirm)
