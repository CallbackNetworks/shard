"""Task attachments, for both doors (ADR-0086).

An agent's output is mostly files — a build log, a report, a diff, a screenshot — and it
had nowhere to put them. Attachments existed and were reachable only by a browser, which
is the one client that already has the file somewhere else.

Two ways in, because the callers differ in kind: the SPA sends multipart from a file input,
and an MCP tool has bytes in hand and no way to build a multipart body. ``store`` takes the
bytes either way, so the size limit, the extension handling and the on-disk naming exist
once — a second upload path that grew its own limit would be a limit that holds on one
door only.
"""

import os
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import Attachment
from app.services import graph
from app.services.errors import Invalid, NotFound

# Where attachments live. Configurable because the default is a *container* path:
# importing this module used to call `mkdir("/app/uploads")` at import time, so on any
# machine where that path is not writable — which is every non-root, non-Docker one —
# `import app.main` raised PermissionError and the test suite could not collect a
# single test. The suite is otherwise Docker-independent (conftest defaults to an
# in-memory SQLite), and CI only ever runs in Docker, so nothing ever noticed.
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


def load_task(db: Session, project_id: str, task_id: str) -> graph.TaskView:
    task = graph.get_task(db, task_id)
    if not task or task_id not in graph.contained_task_ids(db, project_id):
        raise NotFound("Task not found")
    return task


def list_for_task(db: Session, project_id: str, task_id: str) -> list[Attachment]:
    return (
        db.query(Attachment)
        .filter(Attachment.task_id == task_id, Attachment.project_id == project_id)
        .order_by(Attachment.created_at.desc())
        .all()
    )


def get(db: Session, task_id: str, attachment_id: str) -> Attachment:
    att = db.query(Attachment).filter(Attachment.id == attachment_id, Attachment.task_id == task_id).first()
    if not att:
        raise NotFound("Attachment not found")
    return att


def store(
    db: Session,
    project_id: str,
    task_id: str,
    *,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> Attachment:
    """Write bytes to disk and record the row. The caller owns getting the bytes."""
    load_task(db, project_id, task_id)
    if len(content) > MAX_FILE_SIZE:
        raise Invalid("File too large (max 20MB)")

    # Created on first write rather than on import: a module that has been loaded but
    # never used should not have touched the filesystem.
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    storage_path = UPLOAD_DIR / f"{uuid.uuid4()}{Path(filename or 'file').suffix}"
    try:
        storage_path.write_bytes(content)
    except OSError as exc:
        storage_path.unlink(missing_ok=True)
        raise Invalid("Failed to save file") from exc

    attachment = Attachment(
        task_id=task_id,
        project_id=project_id,
        filename=filename or "file",
        content_type=content_type or "application/octet-stream",
        size=len(content),
        storage_path=str(storage_path),
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


def readable_path(db: Session, task_id: str, attachment_id: str) -> Attachment:
    att = get(db, task_id, attachment_id)
    if not os.path.exists(att.storage_path):
        raise NotFound("File not found on disk")
    return att


def delete(db: Session, task_id: str, attachment_id: str) -> None:
    att = get(db, task_id, attachment_id)
    if os.path.exists(att.storage_path):
        os.remove(att.storage_path)
    db.delete(att)
    db.commit()
