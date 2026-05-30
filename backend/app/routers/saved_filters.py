from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SavedFilter
from app.schemas import SavedFilterCreate, SavedFilterOut, SavedFilterUpdate

router = APIRouter(prefix="/saved-filters", tags=["saved-filters"])


@router.get("", response_model=list[SavedFilterOut])
def list_saved_filters(project_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(SavedFilter)
    if project_id:
        q = q.filter(SavedFilter.project_id == project_id)
    return q.order_by(SavedFilter.created_at.desc()).all()


@router.get("/{filter_id}", response_model=SavedFilterOut)
def get_saved_filter(filter_id: str, db: Session = Depends(get_db)):
    sf = db.query(SavedFilter).filter(SavedFilter.id == filter_id).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Saved filter not found")
    return sf


@router.post("", response_model=SavedFilterOut, status_code=status.HTTP_201_CREATED)
def create_saved_filter(body: SavedFilterCreate, db: Session = Depends(get_db)):
    sf = SavedFilter(**body.model_dump())
    db.add(sf)
    db.commit()
    db.refresh(sf)
    return sf


@router.patch("/{filter_id}", response_model=SavedFilterOut)
def update_saved_filter(filter_id: str, body: SavedFilterUpdate, db: Session = Depends(get_db)):
    sf = db.query(SavedFilter).filter(SavedFilter.id == filter_id).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Saved filter not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(sf, field, value)
    db.commit()
    db.refresh(sf)
    return sf


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_filter(filter_id: str, db: Session = Depends(get_db)):
    sf = db.query(SavedFilter).filter(SavedFilter.id == filter_id).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Saved filter not found")
    db.delete(sf)
    db.commit()
