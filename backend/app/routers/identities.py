import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Identity, ProjectIdentity, Project, ActivityLog
from app.schemas import IdentityCreate, IdentityUpdate, IdentityOut

router = APIRouter(prefix="/identities", tags=["identities"])


def _enrich(identity: Identity) -> IdentityOut:
    out = IdentityOut.model_validate(identity)
    out.project_count = len(identity.project_identities)
    out.share_pin_set = identity.share_pin_hash is not None
    out.share_expires_at = identity.share_expires_at
    return out


@router.get("", response_model=list[IdentityOut])
def list_identities(db: Session = Depends(get_db)):
    identities = db.query(Identity).order_by(Identity.created_at.asc()).all()
    return [_enrich(i) for i in identities]


@router.post("", response_model=IdentityOut, status_code=status.HTTP_201_CREATED)
def create_identity(body: IdentityCreate, db: Session = Depends(get_db)):
    identity = Identity(**body.model_dump())
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return _enrich(identity)


@router.patch("/{identity_id}", response_model=IdentityOut)
def update_identity(identity_id: str, body: IdentityUpdate, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(identity, field, value)
    db.commit()
    db.refresh(identity)
    return _enrich(identity)


@router.post("/{identity_id}/rotate-share-token")
def rotate_share_token(identity_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    identity.share_token = str(uuid.uuid4())
    db.commit()
    db.refresh(identity)
    return {"share_token": identity.share_token}


@router.delete("/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_identity(identity_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    db.delete(identity)
    db.commit()


# ── Project ↔ Identity linking ────────────────────────────────────

@router.post("/{identity_id}/projects/{project_id}", status_code=status.HTTP_201_CREATED)
def link_project(identity_id: str, project_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    existing = db.query(ProjectIdentity).filter(
        ProjectIdentity.identity_id == identity_id,
        ProjectIdentity.project_id == project_id,
    ).first()
    if existing:
        return {"status": "already linked"}
    link = ProjectIdentity(project_id=project_id, identity_id=identity_id)
    db.add(link)
    db.commit()
    return {"status": "linked"}


@router.delete("/{identity_id}/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_project(identity_id: str, project_id: str, db: Session = Depends(get_db)):
    link = db.query(ProjectIdentity).filter(
        ProjectIdentity.identity_id == identity_id,
        ProjectIdentity.project_id == project_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()


@router.get("/{identity_id}/projects")
def get_identity_projects(identity_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    return [
        {"id": pi.project.id, "name": pi.project.name, "status": pi.project.status}
        for pi in identity.project_identities
        if pi.project is not None
    ]


# ── Share PIN management ─────────────────────────────────────────

class SetPinBody(BaseModel):
    pin: str


@router.post("/{identity_id}/set-pin")
def set_identity_pin(identity_id: str, body: SetPinBody, db: Session = Depends(get_db)):
    from app.services.pin_utils import hash_pin
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    if not body.pin or len(body.pin) < 4 or len(body.pin) > 6 or not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")
    identity.share_pin_hash = hash_pin(body.pin)
    db.commit()
    return {"ok": True}


@router.delete("/{identity_id}/pin")
def clear_identity_pin(identity_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    identity.share_pin_hash = None
    db.commit()
    return {"ok": True}


# ── Share expiry management ────────���─────────────────────────────

class SetExpiryBody(BaseModel):
    expires_at: datetime | None


@router.post("/{identity_id}/set-expiry")
def set_identity_expiry(identity_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    identity.share_expires_at = body.expires_at
    db.commit()
    return {"ok": True}


# ── Share view count ─────────────────────────────────────────────

@router.get("/{identity_id}/share-views")
def get_share_view_count(identity_id: str, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found")
    count = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.action == "share.viewed",
            ActivityLog.meta["identity_id"].as_string() == identity_id,
        )
        .count()
    )
    return {"view_count": count}
