from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Identity, ProjectIdentity, Project
from app.schemas import IdentityCreate, IdentityUpdate, IdentityOut

router = APIRouter(prefix="/identities", tags=["identities"])


def _enrich(identity: Identity) -> IdentityOut:
    out = IdentityOut.model_validate(identity)
    out.project_count = len(identity.project_identities)
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
