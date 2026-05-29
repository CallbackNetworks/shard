import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, Attachment
from app.schemas import AttachmentOut

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB

router = APIRouter(prefix="/projects/{project_id}/tasks/{task_id}/attachments", tags=["attachments"])


@router.get("", response_model=list[AttachmentOut])
def list_attachments(project_id: str, task_id: str, db: Session = Depends(get_db)):
    return db.query(Attachment).filter(
        Attachment.task_id == task_id,
        Attachment.project_id == project_id,
    ).order_by(Attachment.created_at.desc()).all()


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    project_id: str,
    task_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == task_id, Task.project_id == project_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    file_id = str(uuid.uuid4())
    ext = Path(file.filename or "file").suffix
    storage_name = f"{file_id}{ext}"
    storage_path = UPLOAD_DIR / storage_name

    chunk_size = 64 * 1024  # 64KB
    total_size = 0
    try:
        with open(storage_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    f.close()
                    storage_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=400, detail="File too large (max 20MB)")
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        storage_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to save file") from exc

    attachment = Attachment(
        task_id=task_id,
        project_id=project_id,
        filename=file.filename or "file",
        content_type=file.content_type or "application/octet-stream",
        size=total_size,
        storage_path=str(storage_path),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{attachment_id}/download")
def download_attachment(project_id: str, task_id: str, attachment_id: str, db: Session = Depends(get_db)):
    att = db.query(Attachment).filter(
        Attachment.id == attachment_id,
        Attachment.task_id == task_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not os.path.exists(att.storage_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(att.storage_path, filename=att.filename, media_type=att.content_type)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(project_id: str, task_id: str, attachment_id: str, db: Session = Depends(get_db)):
    att = db.query(Attachment).filter(
        Attachment.id == attachment_id,
        Attachment.task_id == task_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if os.path.exists(att.storage_path):
        os.remove(att.storage_path)
    db.delete(att)
    db.commit()
