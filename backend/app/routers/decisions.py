from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Label
from app.schemas import LabelOut

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("", response_model=list[LabelOut])
def list_decisions(
    project_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Label).filter(Label.type == "decision")
    if project_id:
        q = q.filter(Label.project_id == project_id)
    if status:
        q = q.filter(Label.decision_status == status)
    return q.order_by(Label.created_at.desc()).all()


@router.get("/{decision_id}", response_model=LabelOut)
def get_decision(decision_id: str, db: Session = Depends(get_db)):
    decision = db.query(Label).filter(Label.id == decision_id, Label.type == "decision").first()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")
    return decision


@router.get("/{decision_id}/export", response_class=PlainTextResponse)
def export_decision(decision_id: str, db: Session = Depends(get_db)):
    decision = db.query(Label).filter(Label.id == decision_id, Label.type == "decision").first()
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    status_str = decision.decision_status or "proposed"
    date_str = decision.created_at.strftime("%Y-%m-%d") if decision.created_at else ""

    md = f"# {decision.name}\n\n"
    md += f"## Status\n{status_str.capitalize()}\n\n"
    md += f"## Date\n{date_str}\n\n"

    if decision.description:
        md += decision.description
    else:
        md += "## Context\n\n\n## Decision\n\n\n## Consequences\n\n"

    return PlainTextResponse(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="decision-{decision.name}.md"'},
    )
