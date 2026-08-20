from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ActivityWatchCreate, ActivityWatchOut
from app.services import activity_watches as watches

router = APIRouter(prefix="/activity-watches", tags=["activity"])


@router.get("", response_model=list[ActivityWatchOut])
def list_watches(db: Session = Depends(get_db)):
    return watches.list_watches(db)


@router.post("", response_model=ActivityWatchOut, status_code=status.HTTP_201_CREATED)
def create_watch(body: ActivityWatchCreate, db: Session = Depends(get_db)):
    return watches.create_watch(
        db,
        kind=body.kind,
        target_id=body.target_id,
        target_type=body.target_type,
        label=body.label,
    )


@router.delete("/{watch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watch(watch_id: str, db: Session = Depends(get_db)):
    watches.delete_watch(db, watch_id)
