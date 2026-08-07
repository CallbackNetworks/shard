from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ProjectOut
from app.services import graph
from app.services.enrichment import enrich_project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = graph.all_projects(db)
    return [enrich_project(p, db) for p in projects]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return enrich_project(project, db)


# Project create/update/delete retired (ADR-0043): a project is a container node —
# create/update via POST/PATCH /api/nodes (type "project"), delete via DELETE
# /api/nodes/{id} (the dispatcher cascades its tasks/labels/cycles). Reads + the
# share controls below stay.


# The project-shaped share endpoints (set-expiry, share-views) are gone with ADR-0073:
# a project's share panel is the same NodeShareFacet every other shareable type uses, so
# it reads and writes the generic /api/nodes/{id}/share* endpoints.
