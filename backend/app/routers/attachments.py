"""Task attachments for the SPA.

Thin over ``services/attachment_admin``, which ``/api/v1`` calls too (ADR-0086).
"""

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import AttachmentOut
from app.services import attachment_admin

router = APIRouter(prefix="/projects/{project_id}/tasks/{task_id}/attachments", tags=["attachments"])


@router.get("", response_model=list[AttachmentOut])
def list_attachments(project_id: str, task_id: str, db: Session = Depends(get_db)):
    return attachment_admin.list_for_task(db, project_id, task_id)


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    project_id: str,
    task_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    # One bounded read rather than a chunk loop: the limit lives in the service so both
    # upload paths obey the same one, and reading one byte past it is what proves it was
    # exceeded. Memory stays bounded by MAX_FILE_SIZE.
    content = await file.read(attachment_admin.MAX_FILE_SIZE + 1)
    return attachment_admin.store(
        db,
        project_id,
        task_id,
        filename=file.filename or "file",
        content=content,
        content_type=file.content_type,
    )


@router.get("/{attachment_id}/download")
def download_attachment(project_id: str, task_id: str, attachment_id: str, db: Session = Depends(get_db)):
    att = attachment_admin.readable_path(db, task_id, attachment_id)
    return FileResponse(att.storage_path, filename=att.filename, media_type=att.content_type)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(project_id: str, task_id: str, attachment_id: str, db: Session = Depends(get_db)):
    attachment_admin.delete(db, task_id, attachment_id)
