"""Decision records, for both doors (ADR-0092, ADR-0118).

A decision is a node of its own type since ADR-0118. It was a **label** carrying
``data.type="decision"`` (ADR-0004) — a shape that could not declare its own relations,
because ADR-0078's endpoint rules name node types and ``label -> label`` constrains
nothing.

Reads were the whole of this module: the assistant is told, in its own prompt template, to
write a record when a decision gets made, and could not read any of them back, because the
only route was the internal ``/api``. An agent that writes a record it can never consult is
keeping a diary for somebody else.

Creating one still has no bespoke door — it is a node, so ``POST /api/v1/nodes`` with
``type="decision"`` goes through the single write surface (ADR-0040→0043), and adding a
bespoke create here would be the duplicate ADR-0087 spent its existence removing.

**Supersession is the exception, and it earns it.** Recording that one decision replaces
another is an edge *and* a status change on the far end. Left to the caller those are two
writes that can half-succeed, and the failing half is the one that leaves a record saying
"superseded" with nothing naming the replacement — precisely the dead end ADR-0118 exists
to close. One act, one service, both doors.
"""

from sqlalchemy.orm import Session

from app.services import graph
from app.services.errors import Invalid, NotFound
from app.services.graph_registry import DECISION_STATUSES


def list_decisions(
    db: Session, *, project_id: str | None = None, status: str | None = None
) -> list[graph.DecisionView]:
    if status is not None and status not in DECISION_STATUSES:
        raise Invalid(f"unknown decision status '{status}'; expected one of {', '.join(DECISION_STATUSES)}")
    return graph.decisions(db, project_id=project_id, status=status)


def get(db: Session, decision_id: str) -> graph.DecisionView:
    decision = graph.get_decision(db, decision_id)
    if decision is None:
        raise NotFound("Decision not found")
    return decision


def governing(db: Session, node_id: str) -> list[graph.DecisionView]:
    """The decisions governing a node — "what was decided about this?" from the work's side."""
    if graph.get_node(db, node_id) is None:
        raise NotFound("Node not found")
    return graph.governing(db, node_id)


def supersede(db: Session, decision_id: str, superseded_id: str, *, actor: str | None = None) -> graph.DecisionView:
    """Record that one decision replaces another, and mark the replaced one superseded."""
    if decision_id == superseded_id:
        raise Invalid("A decision cannot supersede itself")
    newer = get(db, decision_id)
    get(db, superseded_id)
    graph.supersede(db, decision_id, superseded_id, actor=actor)
    db.commit()
    return get(db, newer.id)


def unsupersede(db: Session, decision_id: str, superseded_id: str, *, actor: str | None = None) -> graph.DecisionView:
    """Withdraw a supersession; the far end becomes a live decision again."""
    get(db, decision_id)
    get(db, superseded_id)
    if not graph.unsupersede(db, decision_id, superseded_id, actor=actor):
        raise NotFound("That supersession does not exist")
    db.commit()
    return get(db, decision_id)


def export_markdown(db: Session, decision_id: str) -> tuple[str, str]:
    """The record as a Markdown document, with the filename to save it under.

    The heading structure is the project's ADR format, so an exported record drops straight
    into ``docs/adr/`` — which is the whole reason the export exists rather than the caller
    formatting the fields itself. Supersession is written into the ``Status`` line the way
    an ADR states it, because a status of "Superseded" that does not say by what is the
    same dead end on paper that it was in the database.
    """
    decision = get(db, decision_id)
    status = (decision.decision_status or "proposed").capitalize()
    if decision.superseded_by:
        status += " by " + ", ".join(n.title for n in decision.superseded_by)
    date_str = decision.created_at.strftime("%Y-%m-%d") if decision.created_at else ""

    md = f"# {decision.name}\n\n"
    md += f"## Status\n{status}\n\n"
    md += f"## Date\n{date_str}\n\n"
    if decision.supersedes:
        md += "## Supersedes\n" + "".join(f"- {n.title}\n" for n in decision.supersedes) + "\n"
    md += decision.description or "## Context\n\n\n## Decision\n\n\n## Consequences\n\n"
    if decision.governs:
        md += "\n## Governs\n" + "".join(f"- {n.title}\n" for n in decision.governs)
    return md, f"decision-{decision.name}.md"
