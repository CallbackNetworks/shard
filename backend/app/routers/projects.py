from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog
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


# ── Share link expiry and access audit ───────────────────────────
# Mirrors the identity share-link controls so a public project link can be
# time-boxed and its views counted. Audit reuses activity_logs (share.viewed).


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


@router.post("/{project_id}/set-expiry")
def set_project_share_expiry(project_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    graph.update_project(db, project_id, share_expires_at=body.expires_at)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/share-views")
def get_project_share_view_count(project_id: str, db: Session = Depends(get_db)):
    project = graph.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    count = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.action == "share.viewed",
            ActivityLog.meta.isnot(None),
            ActivityLog.meta["project_id"].as_string() == project_id,
        )
        .count()
    )
    return {"view_count": count}
