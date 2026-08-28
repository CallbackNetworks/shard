"""Internal decision-record surface. The acts live in ``services/decision_admin`` (ADR-0092).

Reads plus the one compound write ADR-0118 gives this module: supersession is an edge and a
status together, so it is a service act rather than two calls a client makes in sequence.
Everything else a decision needs — create, edit, delete, ``governs`` links — is a node or an
edge, and goes through the generic surfaces (ADR-0040→0043, ADR-0078).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import DecisionOut
from app.services import decision_admin, downloads

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("", response_model=list[DecisionOut])
def list_decisions(
    project_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    return decision_admin.list_decisions(db, project_id=project_id, status=status)


@router.get("/{decision_id}", response_model=DecisionOut)
def get_decision(decision_id: str, db: Session = Depends(get_db)):
    return decision_admin.get(db, decision_id)


@router.get("/{decision_id}/export", response_class=PlainTextResponse)
def export_decision(decision_id: str, db: Session = Depends(get_db)):
    md, filename = decision_admin.export_markdown(db, decision_id)
    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers=downloads.attachment_headers(filename),
    )


@router.post("/{decision_id}/supersedes/{superseded_id}", response_model=DecisionOut)
def supersede(decision_id: str, superseded_id: str, db: Session = Depends(get_db)):
    return decision_admin.supersede(db, decision_id, superseded_id, actor="user")


@router.delete("/{decision_id}/supersedes/{superseded_id}", response_model=DecisionOut)
def unsupersede(decision_id: str, superseded_id: str, db: Session = Depends(get_db)):
    return decision_admin.unsupersede(db, decision_id, superseded_id, actor="user")


# Mounted apart from the ``/decisions`` prefix: this asks from the work's side.
governing_router = APIRouter(prefix="/nodes/{node_id}/decisions", tags=["decisions"])


@governing_router.get("", response_model=list[DecisionOut])
def decisions_governing(node_id: str, db: Session = Depends(get_db)):
    return decision_admin.governing(db, node_id)
