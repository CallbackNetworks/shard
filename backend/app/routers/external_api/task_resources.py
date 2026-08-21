"""External API v1 — the task sub-resources an agent could see but not touch (ADR-0086).

Three read/write asymmetries, which are a worse defect than a plain missing feature: the
API described a capability it did not offer.

* **recurrence** — ``enrich_task`` puts ``recurrence`` on every ``TaskOut``, so every agent
  reading a task through v1 has been shown the field since it was added, with no way to set
  it. It read ``null`` forever and there was nothing to do about that.
* **attachments** — an agent's output is mostly files, and there was nowhere to put them.
  Upload here takes base64 in JSON rather than multipart: an MCP tool has bytes in hand and
  no way to build a multipart body, and the SPA's file input has no way to produce JSON.
  Both land in one ``store`` so the size limit exists once.
* **cycles** — a task could be *put into* a cycle (``in_cycle`` is an edge, so
  ``/nodes/{id}/edges`` has always covered it) and there was no way to read what a cycle
  contains. Writable, unreadable — the same asymmetry from the other side.
"""

import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import (
    _auth_errors,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.schemas import (
    AttachmentOut,
    CycleOut,
    RecurrenceRuleCreate,
    RecurrenceRuleOut,
    RecurrenceRuleUpdate,
)
from app.services import attachment_admin, cycle_admin, recurrence_admin

sub_router = APIRouter()


# ── Recurrence ────────────────────────────────────────────────────


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}/recurrence",
    response_model=RecurrenceRuleOut,
    summary="Get a task's recurrence rule",
    description=(
        "404 when the task has no rule — the same task read through `/tasks` reports "
        "`recurrence: null` for that case. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_get_recurrence(
    project_id: str, task_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return recurrence_admin.get(db, project_id, task_id)


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/recurrence",
    response_model=RecurrenceRuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Make a task recurring",
    description=(
        "The task becomes a template: the scheduler generates a fresh copy each time "
        "`next_run_at` comes round. A task may have at most one rule — 409 if it already "
        "has one, use PATCH. Requires `write` scope."
    ),
    responses=_auth_errors,
)
def api_set_recurrence(
    project_id: str,
    task_id: str,
    body: RecurrenceRuleCreate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    return recurrence_admin.create(db, project_id, task_id, body)


@sub_router.patch(
    "/projects/{project_id}/tasks/{task_id}/recurrence",
    response_model=RecurrenceRuleOut,
    summary="Change a task's recurrence rule",
    description="Partial update; set `active: false` to pause without losing the rule. Requires `write` scope.",
    responses=_auth_errors,
)
def api_update_recurrence(
    project_id: str,
    task_id: str,
    body: RecurrenceRuleUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    return recurrence_admin.update(db, project_id, task_id, body)


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/recurrence",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop a task recurring",
    responses=_auth_errors,
)
def api_delete_recurrence(
    project_id: str, task_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    recurrence_admin.delete(db, project_id, task_id)


# ── Attachments ───────────────────────────────────────────────────


class AttachmentUpload(BaseModel):
    """A file as JSON, because the callers that need this cannot send multipart."""

    filename: str
    content_base64: str = Field(description="File bytes, base64-encoded. Max 20MB decoded.")
    content_type: str | None = None


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}/attachments",
    response_model=list[AttachmentOut],
    summary="List a task's attachments",
    responses=_auth_errors,
)
def api_list_attachments(
    project_id: str, task_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return attachment_admin.list_for_task(db, project_id, task_id)


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/attachments",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a file to a task",
    description=(
        "Send the bytes base64-encoded in `content_base64` — this is where a build log, a "
        "report or a diff an agent produced belongs, rather than pasted into a comment. "
        "Max 20MB decoded. Requires `write` scope."
    ),
    responses=_auth_errors,
)
def api_upload_attachment(
    project_id: str,
    task_id: str,
    body: AttachmentUpload,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    try:
        content = base64.b64decode(body.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail="content_base64 is not valid base64") from exc
    return attachment_admin.store(
        db,
        project_id,
        task_id,
        filename=body.filename,
        content=content,
        content_type=body.content_type,
    )


@sub_router.get(
    "/projects/{project_id}/tasks/{task_id}/attachments/{attachment_id}/download",
    summary="Download an attachment",
    description="Returns the raw bytes with the stored content type. Requires `read` scope.",
    responses=_auth_errors,
)
def api_download_attachment(
    project_id: str,
    task_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    att = attachment_admin.readable_path(db, task_id, attachment_id)
    # Not FileResponse: the v1 redaction middleware walks JSON bodies and a streaming file
    # response would be handed to it as an opaque iterator. Bytes are bounded at 20MB.
    with open(att.storage_path, "rb") as handle:
        return Response(
            content=handle.read(),
            media_type=att.content_type,
            headers={"Content-Disposition": f'attachment; filename="{att.filename}"'},
        )


@sub_router.delete(
    "/projects/{project_id}/tasks/{task_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an attachment",
    responses=_auth_errors,
)
def api_delete_attachment(
    project_id: str,
    task_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(db, api_key, project_id)
    attachment_admin.delete(db, task_id, attachment_id)


# ── Cycles ────────────────────────────────────────────────────────


@sub_router.get(
    "/projects/{project_id}/cycles",
    response_model=list[CycleOut],
    summary="List a project's cycles",
    description=(
        "Each cycle with its member task ids and done/total counts. Cycles are created and "
        'deleted as nodes (`POST /nodes` with `type: "cycle"`), and membership is the '
        "`in_cycle` edge on `/nodes/{id}/edges` — this is the read that was missing. "
        "Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_cycles(project_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return cycle_admin.list_cycles(db, project_id)


@sub_router.get(
    "/projects/{project_id}/cycles/{cycle_id}",
    response_model=CycleOut,
    summary="Get one cycle",
    responses=_auth_errors,
)
def api_get_cycle(
    project_id: str, cycle_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return cycle_admin.get_cycle(db, project_id, cycle_id)


@sub_router.get(
    "/projects/{project_id}/cycles/{cycle_id}/compare",
    summary="Compare a cycle against the one before it",
    description="Planned vs completed, scope added mid-cycle, and the delta to the previous cycle. Requires `read` scope.",
    responses=_auth_errors,
)
def api_compare_cycle(
    project_id: str,
    cycle_id: str,
    compare_with: str = Query(..., description="Cycle ID to compare against"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(db, api_key, project_id)
    return cycle_admin.compare(db, project_id, cycle_id, compare_with)
