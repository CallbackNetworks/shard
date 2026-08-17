"""Import tasks from external tools: Trello, Linear, GitHub Issues.

The importers themselves live in ``services/task_import`` (ADR-0092) so that
``/api/v1/projects/{id}/import/*`` is the same act through the other door.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import task_import
from app.services.task_import import GitHubImport, ImportResult, LinearImport, TrelloImport

router = APIRouter(tags=["imports"])


@router.post("/projects/{project_id}/import/trello", response_model=ImportResult)
async def import_trello(project_id: str, body: TrelloImport, db: Session = Depends(get_db)):
    return await task_import.import_trello(db, project_id, body)


@router.post("/projects/{project_id}/import/linear", response_model=ImportResult)
async def import_linear(project_id: str, body: LinearImport, db: Session = Depends(get_db)):
    return await task_import.import_linear(db, project_id, body)


@router.post("/projects/{project_id}/import/github", response_model=ImportResult)
async def import_github(project_id: str, body: GitHubImport, db: Session = Depends(get_db)):
    return await task_import.import_github(db, project_id, body)
