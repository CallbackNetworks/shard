"""External API v1 — how work gets into the system, out of it, and filed (ADR-0092).

The content half of what was still browser-only: importing from Trello/Linear/GitHub,
publishing a task outward as a real issue, the unfiled bucket, decision records, and rolling
a cycle over. Every act delegates to the service the internal router already calls, so
neither door writes a refusal (ADR-0085).

Scopes: `write` for anything that creates tasks or an external issue, `read` for the bucket
and the decision records. None of these responses carries a credential, so nothing here
needs `admin` — the ADR-0084 argument does not apply and inventing a stricter rule than the
precedent would just make the door less useful than the browser it replaces.
"""

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.schemas import CycleOut, LabelOut, TaskOut
from app.services import cycle_admin, decision_admin, issue_sync_admin, task_filing, task_import
from app.services.task_import import GitHubImport, ImportResult, LinearImport, TrelloImport

sub_router = APIRouter()


# ── Importing work from elsewhere ───────────────────────────────────


@sub_router.post(
    "/projects/{project_id}/import/github",
    response_model=ImportResult,
    summary="Import GitHub issues as tasks",
    description=(
        "Takes `{issues: [...]}` in GitHub's own issue shape — `number`, `title`, `body`, "
        "`state`, `html_url`, `labels[].name`, `assignee.login`. A closed issue becomes a "
        "done task; the number and URL are kept as the task's external link, so the "
        "two-way issue sync can pick it up later. Labels are matched by name in the project "
        "and created if missing. A row that cannot be imported is counted in `skipped` with "
        "a line in `errors` — one bad issue does not abandon the other twenty. Requires "
        "`write` scope."
    ),
    responses=_auth_errors,
)
async def api_import_github(
    project_id: str,
    body: GitHubImport,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await task_import.import_github(db, project_id, body)


@sub_router.post(
    "/projects/{project_id}/import/linear",
    response_model=ImportResult,
    summary="Import Linear issues as tasks",
    description=(
        "Takes `{issues: [...]}` with `title`, `description`, `state`, `priority` (Linear's "
        "1-4, mapped to high/medium/low), `assignee` and `labels[]`. Same partial-success "
        "contract as the GitHub importer. Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_import_linear(
    project_id: str,
    body: LinearImport,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await task_import.import_linear(db, project_id, body)


@sub_router.post(
    "/projects/{project_id}/import/trello",
    response_model=ImportResult,
    summary="Import Trello cards as tasks",
    description=(
        "Takes `{cards: [...]}` with `name`, `desc`, `closed`, `due` and `labels[].name`. A "
        "closed card becomes a done task and `due` becomes the task's due date. Same "
        "partial-success contract as the other importers. Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_import_trello(
    project_id: str,
    body: TrelloImport,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await task_import.import_trello(db, project_id, body)


# ── Publishing work outward ─────────────────────────────────────────


class CreateExternalIssueRequest(BaseModel):
    provider: str | None = None


@sub_router.post(
    "/projects/{project_id}/tasks/{task_id}/create-external-issue",
    response_model=TaskOut,
    summary="Publish a task as a new GitHub/GitLab issue",
    description=(
        "Creates the issue and links it to the task, which becomes the source of truth for "
        "it; afterwards the ordinary two-way sync carries state, comments and labels both "
        "ways. `provider` is detected from the project's repo URL and only needs passing "
        "when that is ambiguous. Needs an active `issue_sync` integration holding a token "
        "and a repo URL on the project — without either it refuses and says which is "
        "missing. A task already linked to an issue is a 409. Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_create_external_issue(
    project_id: str,
    task_id: str,
    body: CreateExternalIssueRequest | None = None,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await issue_sync_admin.create_from_task(db, project_id, task_id, body.provider if body else None)


# ── The unfiled bucket ──────────────────────────────────────────────


@sub_router.get(
    "/tasks/unfiled",
    response_model=list[TaskOut],
    summary="Tasks that belong to no project",
    description=(
        "A task may legally reach zero project memberships (ADR-0032/0033); when it does it "
        "is *unfiled* rather than lost. Listing tasks by project cannot show these by "
        "definition, which is why they need their own read — this is the inbox the "
        "`triage-inbox` prompt is about. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_unfiled(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return task_filing.list_unfiled(db)


@sub_router.post(
    "/tasks/{task_id}/memberships/{project_id}",
    response_model=TaskOut,
    status_code=status.HTTP_201_CREATED,
    summary="File a task into a project",
    description=(
        "Adds a `contains` edge from the project to the task. Unlike the project-scoped "
        "membership route this does not require a source project, so it is how an unfiled "
        "task gets its first one. Idempotent, and a task may belong to several projects. "
        "Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_file_task(
    task_id: str,
    project_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await task_filing.file_into_project(db, task_id, project_id)


# ── Decision records ────────────────────────────────────────────────


@sub_router.get(
    "/decisions",
    response_model=list[LabelOut],
    summary="Decision records",
    description=(
        "Decisions recorded against the work, optionally narrowed by `project_id` or "
        "`status` (proposed/accepted/superseded/deprecated). The assistant is told to write "
        "one when a decision gets made, and this is how it — or any other agent — reads back "
        'what was already decided. Writing one is `POST /nodes` with `type="decision"`, '
        "through the single node write surface. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_list_decisions(
    project_id: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "read")
    return decision_admin.list_decisions(db, project_id=project_id or api_key.project_id, status=status)


@sub_router.get(
    "/decisions/{decision_id}",
    response_model=LabelOut,
    summary="One decision record",
    responses=_auth_errors,
)
def api_get_decision(decision_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return decision_admin.get(db, decision_id)


@sub_router.get(
    "/decisions/{decision_id}/export",
    response_class=PlainTextResponse,
    summary="One decision record as Markdown",
    description=(
        "Status / Date / body under the project's ADR headings, ready to commit to "
        "`docs/adr/`. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_export_decision(decision_id: str, db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    md, filename = decision_admin.export_markdown(db, decision_id)
    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Rolling a cycle over ────────────────────────────────────────────


@sub_router.post(
    "/projects/{project_id}/cycles/{cycle_id}/duplicate",
    response_model=CycleOut,
    status_code=status.HTTP_201_CREATED,
    summary="Copy a cycle and its tasks into a new draft",
    description=(
        "Creates a draft cycle named `<name> (copy)` holding a fresh `todo` task for every "
        "task in the source, carrying title, description, priority, assignee and estimate. "
        "Status and time spent do not follow: what is copied is the intent to do the work, "
        "not the record of having done it. This is sprint rollover, and it is planning — "
        "which is what the agent is for. Requires `write` scope."
    ),
    responses=_auth_errors,
)
async def api_duplicate_cycle(
    project_id: str,
    cycle_id: str,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "write")
    return await cycle_admin.duplicate(db, project_id, cycle_id)
