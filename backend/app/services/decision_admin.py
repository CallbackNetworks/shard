"""Decision records, for both doors (ADR-0092).

A decision is a **label** node carrying ``data.type="decision"`` and a status of its own.
The assistant is told, in its own prompt template, to write one when a decision gets made — and
then could not read any of them back, because the only route was the internal ``/api``. An
agent that writes a record it can never consult is keeping a diary for somebody else.

Read-only on purpose. Writing a decision already has a door: it is a node, so
``POST /api/v1/nodes`` with ``type="label"`` and ``data={"type": "decision", ...}`` creates one
through the single write surface (ADR-0040→0043). Adding a bespoke write here would be the
duplicate ADR-0087 spent its existence removing.

That sentence used to say ``type="decision"``, which is not a node type and never was — the
registry holds no such key, so the one write this module points at answered
422 ``unknown node type 'decision'``. ADR-0004 stores a decision as a *label*; the argument
for staying read-only was right and the address it gave was wrong.
"""

from sqlalchemy.orm import Session

from app.schemas import LabelOut
from app.services import graph
from app.services.errors import NotFound


def list_decisions(db: Session, *, project_id: str | None = None, status: str | None = None) -> list[LabelOut]:
    return graph.decisions(db, project_id=project_id, status=status)


def get(db: Session, decision_id: str) -> graph.LabelView:
    decision = graph.get_label(db, decision_id)
    if not decision or decision.type != "decision":
        raise NotFound("Decision not found")
    return decision


def export_markdown(db: Session, decision_id: str) -> tuple[str, str]:
    """The record as a Markdown document, with the filename to save it under.

    The heading structure is the project's ADR format, so an exported record drops straight
    into ``docs/adr/`` — which is the whole reason the export exists rather than the caller
    formatting the fields itself.
    """
    decision = get(db, decision_id)
    status = decision.decision_status or "proposed"
    date_str = decision.created_at.strftime("%Y-%m-%d") if decision.created_at else ""

    md = f"# {decision.name}\n\n"
    md += f"## Status\n{status.capitalize()}\n\n"
    md += f"## Date\n{date_str}\n\n"
    md += decision.description or "## Context\n\n\n## Decision\n\n\n## Consequences\n\n"
    return md, f"decision-{decision.name}.md"
