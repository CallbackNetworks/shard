"""External API v1 — task templates and bulk export/import (ADR-0086).

Two things an agent needs to work at more than one task at a time.

**Templates** are the shape of a task somebody writes down once. An agent creating the same
five-step structure repeatedly was retyping it every time, with nothing to keep the versions
in step.

**Export/import** is the round trip. v1 could create tasks one at a time and in bulk, but a
project's work could not be taken *out*, so migrating between projects, seeding from a plan
or handing a snapshot to something else were browser-only.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, TaskTemplate
from app.routers.external_api.auth import (
    _auth_errors,
    _build_actor,
    _check_project_access,
    _get_api_key,
    _require_scope,
)
from app.schemas import (
    TaskImportRequest,
    TaskImportResult,
    TaskTemplateCreate,
    TaskTemplateOut,
    TaskTemplateUpdate,
)
from app.services import task_transfer
from app.services.ws_manager import ws_manager

sub_router = APIRouter()


# ── Templates ─────────────────────────────────────────────────────


def _template_or_404(db: Session, template_id: str) -> TaskTemplate:
    tpl = db.query(TaskTemplate).filter(TaskTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@sub_router.get(
    "/templates",
    response_model=list[TaskTemplateOut],
    summary="List task templates",
    description=(
        "Reusable task shapes. Passing `project_id` returns that project's templates plus "
        "the global ones, which apply everywhere. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_templates(
    project_id: str | None = Query(None),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    scope = project_id or api_key.project_id
    q = db.query(TaskTemplate)
    if scope:
        q = q.filter((TaskTemplate.project_id == scope) | (TaskTemplate.project_id.is_(None)))
    return q.order_by(TaskTemplate.created_at.desc()).all()


@sub_router.post(
    "/templates",
    response_model=TaskTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a task template",
    description="Leave `project_id` null for a template that applies to every project. Requires `write` scope.",
    responses=_auth_errors,
)
def api_create_template(
    body: TaskTemplateCreate, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)
):
    _require_scope(api_key, "write")
    if api_key.project_id and body.project_id != api_key.project_id:
        raise HTTPException(status_code=403, detail="API key can only create templates within its project")
    tpl = TaskTemplate(**body.model_dump())
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl


@sub_router.patch(
    "/templates/{template_id}",
    response_model=TaskTemplateOut,
    summary="Update a task template",
    responses=_auth_errors,
)
def api_update_template(
    template_id: str,
    body: TaskTemplateUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    tpl = _template_or_404(db, template_id)
    if api_key.project_id and tpl.project_id != api_key.project_id:
        raise HTTPException(status_code=403, detail="API key does not have access to this template")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tpl, field, value)
    db.commit()
    db.refresh(tpl)
    return tpl


@sub_router.delete(
    "/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a task template",
    responses=_auth_errors,
)
def api_delete_template(template_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "write")
    tpl = _template_or_404(db, template_id)
    if api_key.project_id and tpl.project_id != api_key.project_id:
        raise HTTPException(status_code=403, detail="API key does not have access to this template")
    db.delete(tpl)
    db.commit()


# ── Bulk export / import ──────────────────────────────────────────


@sub_router.get(
    "/projects/{project_id}/tasks/export",
    summary="Export a project's tasks",
    description=(
        "Every task in the project as flat rows, in board order. `format=json` (default) "
        "returns an array; `format=csv` returns a CSV body. The JSON rows are the same "
        "shape `tasks/import` accepts, so export → import is a round trip. Requires `read` "
        "scope."
    ),
    responses=_auth_errors,
)
def api_export_tasks(
    project_id: str,
    format: str = Query("json", pattern="^(json|csv)$"),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    _check_project_access(api_key, project_id)
    rows = task_transfer.export_rows(db, project_id)
    if format == "csv":
        import csv
        import io

        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=task_transfer.EXPORT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=tasks-{project_id}.csv"},
        )
    return rows


@sub_router.post(
    "/projects/{project_id}/tasks/import",
    response_model=TaskImportResult,
    summary="Import a tree of tasks into a project",
    description=(
        "Creates tasks, nesting `subtasks` recursively. The whole tree lands as one "
        "transaction and one notification, rather than N of each. Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_import_tasks(
    project_id: str,
    body: TaskImportRequest,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    _check_project_access(api_key, project_id)
    created_ids = await task_transfer.import_tasks(db, project_id, body.tasks, actor=_build_actor(api_key))
    await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": created_ids})
    return TaskImportResult(imported=len(created_ids), task_ids=created_ids)
