"""Importing work from Trello, Linear and GitHub Issues, for both doors (ADR-0092).

This is the most agent-shaped capability in the system — take a pile of issues from
somewhere else and turn them into tasks — and it was the one only a person with a browser
could start. The Settings page had a file picker; ``/api/v1`` had nothing, so an agent
holding a GitHub issue list had to create the tasks one POST at a time and reimplement the
label matching, the state mapping and the priority mapping while it did.

The three importers keep their own shape because the sources genuinely differ (Trello has
``closed``, Linear has a 1-4 priority, GitHub has a number and an html_url worth keeping as
the external link), but everything after "what does this source call it" is shared: labels
are found-or-created by name, the task-create pipeline runs per task with
``commit=False, broadcast=False``, and the batch lands in one transaction and one broadcast.

A bad row does not abort the import. Twenty good issues and one with no title should be
twenty tasks and one line in ``errors``, not a 422 and nothing — which is why the result is
``{imported, skipped, errors}`` rather than a status code.
"""

import logging
import uuid
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.services import graph
from app.services.activity import log_activity
from app.services.errors import NotFound
from app.services.task_mutations import finalize_task_create
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

DEFAULT_LABEL_COLOR = "#6366f1"

SOURCE_LABELS = {"trello": "Trello", "linear": "Linear", "github": "GitHub Issues"}


# --- Trello schemas ---


class TrelloLabel(BaseModel):
    name: str = ""


class TrelloCard(BaseModel):
    name: str
    desc: str | None = None
    closed: bool = False
    labels: list[TrelloLabel] = []
    due: str | None = None


class TrelloImport(BaseModel):
    cards: list[TrelloCard] = []


# --- Linear schemas ---


class LinearIssue(BaseModel):
    title: str
    description: str | None = None
    state: str | None = None
    priority: int | None = None
    assignee: str | None = None
    labels: list[str] = []


class LinearImport(BaseModel):
    issues: list[LinearIssue] = []


# --- GitHub schemas ---


class GitHubLabel(BaseModel):
    name: str = ""


class GitHubAssignee(BaseModel):
    login: str = ""


class GitHubIssue(BaseModel):
    number: int | None = None
    title: str
    body: str | None = None
    state: str = "open"
    html_url: str | None = None
    labels: list[GitHubLabel] = []
    assignee: GitHubAssignee | None = None


class GitHubImport(BaseModel):
    issues: list[GitHubIssue] = []


# --- Response schema ---


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str]


def _get_or_create_label(db: Session, project_id: str, label_name: str) -> graph.LabelView | None:
    """Find an existing label by name in the project, or create one."""
    label_name = label_name.strip()
    if not label_name:
        return None
    existing = graph.find_label_by_name(db, project_id, label_name)
    if existing:
        return existing
    return graph.create_label(db, project_id, name=label_name, color=DEFAULT_LABEL_COLOR)


def _validate_project(db: Session, project_id: str) -> graph.ProjectView:
    project = graph.get_project(db, project_id)
    if not project:
        raise NotFound("Project not found")
    return project


async def _attach_labels_and_finalize(
    db: Session, task_id: str, project_id: str, label_names: list[str], source: str
) -> None:
    """Labels are attached before finalizing so label-based workflow rules see the task in
    its finished shape."""
    for name in label_names:
        if name and name.strip():
            label = _get_or_create_label(db, project_id, name)
            if label:
                graph.set_label(db, task_id, label.id)
    await finalize_task_create(
        db,
        task_id,
        actor="import",
        source="import",
        project_id=project_id,
        activity_meta={"source": source},
        commit=False,
        broadcast=False,
    )


async def _finish_import(db: Session, project_id: str, source: str, task_ids: list[str], skipped: int) -> None:
    """Log the import summary and emit one aggregate event for the whole batch.

    Per-task pipeline runs already happened with commit=False/broadcast=False,
    so the batch lands in a single transaction and a single broadcast.
    """
    if task_ids:
        log_activity(
            db,
            action=f"import.{source}",
            project_id=project_id,
            actor="import",
            detail=f"Imported {len(task_ids)} tasks from {SOURCE_LABELS[source]}",
            meta={"source": source, "imported": len(task_ids), "skipped": skipped},
        )

    db.commit()
    if task_ids:
        await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": task_ids})


# ── Trello ──────────────────────────────────────────────────────────────


async def import_trello(db: Session, project_id: str, body: TrelloImport) -> ImportResult:
    _validate_project(db, project_id)
    imported: list[str] = []
    skipped = 0
    errors: list[str] = []

    for card in body.cards:
        try:
            if not card.name or not card.name.strip():
                skipped += 1
                continue

            due_date = None
            if card.due:
                try:
                    due_date = datetime.fromisoformat(card.due.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass

            task = graph.create_task(
                db,
                id=str(uuid.uuid4()),
                project_id=project_id,
                title=card.name.strip(),
                description=card.desc,
                status="done" if card.closed else "todo",
                priority="medium",
                due_date=due_date,
                callback_token=str(uuid.uuid4()),
            )
            await _attach_labels_and_finalize(db, task.id, project_id, [lb.name for lb in card.labels], "trello")
            imported.append(task.id)
        except Exception as exc:
            errors.append(f"Card '{card.name}': {exc}")
            skipped += 1

    await _finish_import(db, project_id, "trello", imported, skipped)
    return ImportResult(imported=len(imported), skipped=skipped, errors=errors)


# ── Linear ──────────────────────────────────────────────────────────────


def _map_linear_state(state: str | None) -> str:
    """Map Linear issue state to internal task status."""
    if not state:
        return "todo"
    normalized = state.strip().lower()
    if normalized in ("done", "completed"):
        return "done"
    if normalized in ("in progress",):
        return "in_progress"
    return "todo"


def _map_linear_priority(priority: int | None) -> str:
    """Map Linear priority (1-4) to internal priority."""
    if priority is None:
        return "medium"
    if priority <= 2:
        return "high"
    if priority == 3:
        return "medium"
    return "low"


async def import_linear(db: Session, project_id: str, body: LinearImport) -> ImportResult:
    _validate_project(db, project_id)
    imported: list[str] = []
    skipped = 0
    errors: list[str] = []

    for issue in body.issues:
        try:
            if not issue.title or not issue.title.strip():
                skipped += 1
                continue

            task = graph.create_task(
                db,
                id=str(uuid.uuid4()),
                project_id=project_id,
                title=issue.title.strip(),
                description=issue.description,
                status=_map_linear_state(issue.state),
                priority=_map_linear_priority(issue.priority),
                assignee=issue.assignee,
                callback_token=str(uuid.uuid4()),
            )
            await _attach_labels_and_finalize(db, task.id, project_id, list(issue.labels), "linear")
            imported.append(task.id)
        except Exception as exc:
            errors.append(f"Issue '{issue.title}': {exc}")
            skipped += 1

    await _finish_import(db, project_id, "linear", imported, skipped)
    return ImportResult(imported=len(imported), skipped=skipped, errors=errors)


# ── GitHub Issues ───────────────────────────────────────────────────────


async def import_github(db: Session, project_id: str, body: GitHubImport) -> ImportResult:
    _validate_project(db, project_id)
    imported: list[str] = []
    skipped = 0
    errors: list[str] = []

    for issue in body.issues:
        try:
            if not issue.title or not issue.title.strip():
                skipped += 1
                continue

            task = graph.create_task(
                db,
                id=str(uuid.uuid4()),
                project_id=project_id,
                title=issue.title.strip(),
                description=issue.body,
                status="done" if issue.state == "closed" else "todo",
                priority="medium",
                assignee=issue.assignee.login if issue.assignee else None,
                external_provider="github",
                external_id=str(issue.number) if issue.number is not None else None,
                external_url=issue.html_url,
                callback_token=str(uuid.uuid4()),
            )
            # sync_external is not a concern here: finalize_task_create does not
            # push outward, so importing a GitHub issue cannot echo back to GitHub.
            await _attach_labels_and_finalize(db, task.id, project_id, [lb.name for lb in issue.labels], "github")
            imported.append(task.id)
        except Exception as exc:
            errors.append(f"Issue '{issue.title}': {exc}")
            skipped += 1

    await _finish_import(db, project_id, "github", imported, skipped)
    return ImportResult(imported=len(imported), skipped=skipped, errors=errors)
