from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import FocusTargetOut
from app.services import graph

# Reads only (ADR-0081). The sidebar's Focus control narrows the app by any node
# that can reach projects via contains/owns, not just identity — see
# graph.all_focus_targets. Writes to the underlying identity/organization nodes
# go through the single graph write surface (/api/nodes), same as identities.py.
router = APIRouter(prefix="/focus-targets", tags=["focus"])


@router.get("", response_model=list[FocusTargetOut])
def list_focus_targets(db: Session = Depends(get_db)):
    return graph.all_focus_targets(db)
