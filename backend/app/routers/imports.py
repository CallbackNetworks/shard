"""Import tasks from external tools: Trello, Linear, GitHub Issues."""

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import graph
from app.services.activity import log_activity
from app.services.task_mutations import finalize_task_create
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["imports"])

DEFAULT_LABEL_COLOR = "#6366f1"


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
    """Return the project or raise 404."""
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


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
            detail=f"Imported {len(task_ids)} tasks from {_SOURCE_LABELS[source]}",
            meta={"source": source, "imported": len(task_ids), "skipped": skipped},
        )

    db.commit()
    if task_ids:
        await ws_manager.broadcast("task.imported", {"project_id": project_id, "task_ids": task_ids})


_SOURCE_LABELS = {"trello": "Trello", "linear": "Linear", "github": "GitHub Issues"}


# ── Trello ──────────────────────────────────────────────────────────────


@router.post("/projects/{project_id}/import/trello", response_model=ImportResult)
async def import_trello(project_id: str, body: TrelloImport, db: Session = Depends(get_db)):
    _validate_project(db, project_id)
    imported: list[str] = []
    skipped = 0
    errors: list[str] = []

    for card in body.cards:
        try:
            if not card.name or not card.name.strip():
                skipped += 1
                continue

            status = "done" if card.closed else "todo"

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
                status=status,
                priority="medium",
                due_date=due_date,
                callback_token=str(uuid.uuid4()),
            )

            for lbl in card.labels:
                if lbl.name and lbl.name.strip():
                    label = _get_or_create_label(db, project_id, lbl.name)
                    if label:
                        graph.set_label(db, task.id, label.id)

            # Labels are attached before finalizing so label-based workflow
            # rules see the task in its finished shape.
            await finalize_task_create(
                db,
                task.id,
                actor="import",
                source="import",
                project_id=project_id,
                activity_meta={"source": "trello"},
                commit=False,
                broadcast=False,
            )
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


@router.post("/projects/{project_id}/import/linear", response_model=ImportResult)
async def import_linear(project_id: str, body: LinearImport, db: Session = Depends(get_db)):
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

            for lbl_name in issue.labels:
                if lbl_name and lbl_name.strip():
                    label = _get_or_create_label(db, project_id, lbl_name)
                    if label:
                        graph.set_label(db, task.id, label.id)

            await finalize_task_create(
                db,
                task.id,
                actor="import",
                source="import",
                project_id=project_id,
                activity_meta={"source": "linear"},
                commit=False,
                broadcast=False,
            )
            imported.append(task.id)
        except Exception as exc:
            errors.append(f"Issue '{issue.title}': {exc}")
            skipped += 1

    await _finish_import(db, project_id, "linear", imported, skipped)
    return ImportResult(imported=len(imported), skipped=skipped, errors=errors)


# ── GitHub Issues ───────────────────────────────────────────────────────


@router.post("/projects/{project_id}/import/github", response_model=ImportResult)
async def import_github(project_id: str, body: GitHubImport, db: Session = Depends(get_db)):
    _validate_project(db, project_id)
    imported: list[str] = []
    skipped = 0
    errors: list[str] = []

    for issue in body.issues:
        try:
            if not issue.title or not issue.title.strip():
                skipped += 1
                continue

            status = "done" if issue.state == "closed" else "todo"
            assignee = issue.assignee.login if issue.assignee else None

            task = graph.create_task(
                db,
                id=str(uuid.uuid4()),
                project_id=project_id,
                title=issue.title.strip(),
                description=issue.body,
                status=status,
                priority="medium",
                assignee=assignee,
                external_provider="github",
                external_id=str(issue.number) if issue.number is not None else None,
                external_url=issue.html_url,
                callback_token=str(uuid.uuid4()),
            )

            for lbl in issue.labels:
                if lbl.name and lbl.name.strip():
                    label = _get_or_create_label(db, project_id, lbl.name)
                    if label:
                        graph.set_label(db, task.id, label.id)

            # sync_external is not a concern here: finalize_task_create does not
            # push outward, so importing a GitHub issue cannot echo back to GitHub.
            await finalize_task_create(
                db,
                task.id,
                actor="import",
                source="import",
                project_id=project_id,
                activity_meta={"source": "github"},
                commit=False,
                broadcast=False,
            )
            imported.append(task.id)
        except Exception as exc:
            errors.append(f"Issue '{issue.title}': {exc}")
            skipped += 1

    await _finish_import(db, project_id, "github", imported, skipped)
    return ImportResult(imported=len(imported), skipped=skipped, errors=errors)
