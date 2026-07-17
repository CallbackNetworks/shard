from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import LabelOut
from app.services import graph

router = APIRouter(prefix="/decisions", tags=["decisions"])


def _get_decision_or_404(decision_id: str, db: Session) -> graph.LabelView:
    decision = graph.get_label(db, decision_id)
    if not decision or decision.type != "decision":
        raise HTTPException(status_code=404, detail="Decision not found")
    return decision


@router.get("", response_model=list[LabelOut])
def list_decisions(
    project_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    return graph.decisions(db, project_id=project_id, status=status)


@router.get("/{decision_id}", response_model=LabelOut)
def get_decision(decision_id: str, db: Session = Depends(get_db)):
    return _get_decision_or_404(decision_id, db)


@router.get("/{decision_id}/export", response_class=PlainTextResponse)
def export_decision(decision_id: str, db: Session = Depends(get_db)):
    decision = _get_decision_or_404(decision_id, db)

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
