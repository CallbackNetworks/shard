from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import ActivityLog, Project
from app.schemas import ProjectCreate, ProjectOut, ProjectUpdate
from app.services.activity import log_activity
from app.services.enrichment import enrich_project
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_eager_options():
    from app.models import Cycle, ProjectIdentity, Task, TaskLabel

    return [
        selectinload(Project.tasks).selectinload(Task.task_labels).selectinload(TaskLabel.label),
        selectinload(Project.tasks).selectinload(Task.subtasks),
        selectinload(Project.tasks).selectinload(Task.comments),
        selectinload(Project.tasks).selectinload(Task.assigned_agent),
        selectinload(Project.labels),
        selectinload(Project.cycles).selectinload(Cycle.cycle_tasks),
        selectinload(Project.project_identities).selectinload(ProjectIdentity.identity),
    ]


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).options(*_project_eager_options()).order_by(Project.created_at.desc()).all()
    return [enrich_project(p, db) for p in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(**body.model_dump())
    db.add(project)
    db.flush()
    log_activity(
        db,
        "project.created",
        project_id=project.id,
        detail=f'Project "{project.name}" created',
    )
    db.commit()
    db.refresh(project)
    await ws_manager.broadcast("project.created", {"project_id": project.id})
    return enrich_project(project, db)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).options(*_project_eager_options()).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return enrich_project(project, db)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    changes = body.model_dump(exclude_none=True)
    old_status = project.status
    for field, value in changes.items():
        setattr(project, field, value)
    if "status" in changes and changes["status"] != old_status:
        log_activity(
            db,
            f"project.{changes['status']}",
            project_id=project_id,
            detail=f'Project "{project.name}" changed to {changes["status"]}',
            meta={"old_status": old_status, "new_status": changes["status"]},
        )
    db.commit()
    db.refresh(project)
    await ws_manager.broadcast("project.updated", {"project_id": project_id})
    return enrich_project(project, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    log_activity(
        db,
        "project.deleted",
        project_id=project_id,
        detail=f'Project "{project.name}" deleted',
    )
    db.delete(project)
    db.commit()
    await ws_manager.broadcast("project.deleted", {"project_id": project_id})


# ── Share link expiry and access audit ───────────────────────────
# Mirrors the identity share-link controls so a public project link can be
# time-boxed and its views counted. Audit reuses activity_logs (share.viewed).


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


@router.post("/{project_id}/set-expiry")
def set_project_share_expiry(project_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.share_expires_at = body.expires_at
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/share-views")
def get_project_share_view_count(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
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
