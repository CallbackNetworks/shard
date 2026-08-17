"""Internal decision-record reads. The acts live in ``services/decision_admin`` (ADR-0092)."""

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import LabelOut
from app.services import decision_admin

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("", response_model=list[LabelOut])
def list_decisions(
    project_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    return decision_admin.list_decisions(db, project_id=project_id, status=status)


@router.get("/{decision_id}", response_model=LabelOut)
def get_decision(decision_id: str, db: Session = Depends(get_db)):
    return decision_admin.get(db, decision_id)


@router.get("/{decision_id}/export", response_class=PlainTextResponse)
def export_decision(decision_id: str, db: Session = Depends(get_db)):
    md, filename = decision_admin.export_markdown(db, decision_id)
    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
