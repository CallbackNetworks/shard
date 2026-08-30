"""Decision records as a node type of their own (ADR-0118).

Named ``decision_records`` rather than ``decisions`` so the facade's ``graph.decisions``
is unambiguously the listing function and not this module.

ADR-0004 stored a decision as a ``label`` node carrying ``data.type="decision"``. That
was the right shape while a decision was a tag you stuck on a task, and the wrong one the
moment a decision needed relations: ADR-0078's endpoint declarations name node *types*, so
the strongest rule the old shape could express was ``label -> label`` — which constrains
nothing and would have let any tag supersede any other. The modelling was already fighting
itself elsewhere, too: ``label_names`` had to *subtract* decisions from the label
vocabulary so a workflow rule would not offer one.

A decision carries no roles. It is not a place work lives and it is not a piece of work,
so it stays out of every size and progress rollup (ADR-0068) exactly as it did before, while
``contains`` still files it under a project the way it filed the label.

Two relations make the record answerable about itself (both declared in
``graph_registry``):

``supersedes``  newer decision -> the one it replaces. The ``superseded`` status is a
                consequence of this edge, never typed on its own — a status saying "this
                was replaced" while nothing says by what is a dead end, which is what
                production held for all nine of them.
``governs``     decision -> the task or container it decides. The reverse read
                (:func:`governing`) is the question that had no query at all: labels
                could be listed for a task, and the work could never be listed for a
                decision.

Two more make a decision answerable about the *other decisions* around it (ADR-0127).
Production ran for months with 103 records, two ``supersedes`` edges and one ``governs``,
so 98 of them named nothing and were named by nothing — a decision graph with no edges is
a list wearing a graph's name, and the missing edges were the ones a record most often
actually has:

``requires``        decision -> the decision it takes as a premise. This one holds only
                    while that one does. Not ``supersedes`` (which retires the far end)
                    and not ``depends_on`` (which means "blocked until done", and a
                    decision is never done).
``conflicts_with``  decision <-> the decision that contradicts it. Stored one way like
                    every edge and **read both ways**: the claim is symmetric, so a record
                    that only looked at its own outgoing edges would read as clean while
                    the record it contradicts already said otherwise.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Edge, Node
from app.services.errors import Unprocessable
from app.services.graph.core import (
    NODE_DECISION,
    NODE_LABEL,
    REL_CONFLICTS_WITH,
    REL_CONTAINS,
    REL_GOVERNS,
    REL_REQUIRES,
    REL_SUPERSEDES,
    add_edge,
    create_node,
    project_container_map,
    remove_edge,
)

# Status vocabulary lives in the type registry (the editor's picker reads the same list).
STATUS_PROPOSED = "proposed"
STATUS_SUPERSEDED = "superseded"

# A decision's state is the ``nodes.status`` column, like every other type's (ADR-0130).
# It rode in ``data["decision_status"]`` from the label era, which left the column NULL on
# all 103 production records and made this the one type whose state a generic node filter
# could not see. The response contract still says ``decision_status`` — that name is what
# every reader, the share page and the assistant were written against, and the storage
# moving is not a reason to break them.
LEGACY_STATUS_KEY = "decision_status"


@dataclass
class DecisionView:
    """The historical ``LabelOut`` attribute surface, plus the relations.

    Keeping ``type`` on the view — always the constant ``"decision"`` — is deliberate:
    every existing reader, ``/api/v1/decisions`` included, was written against a label
    whose ``data.type`` said ``decision``, and the response contract does not change just
    because the storage did.
    """

    id: str
    project_id: str | None
    name: str
    color: str
    description: str | None
    decision_status: str | None
    source: str | None
    created_at: datetime
    type: str = "decision"
    supersedes: list[Node] = field(default_factory=list)
    superseded_by: list[Node] = field(default_factory=list)
    governs: list[Node] = field(default_factory=list)
    requires: list[Node] = field(default_factory=list)
    required_by: list[Node] = field(default_factory=list)
    conflicts_with: list[Node] = field(default_factory=list)


def _view(node: Node, project_id: str | None, links: dict | None = None) -> DecisionView:
    data = node.data or {}
    links = links or {}
    return DecisionView(
        id=node.id,
        project_id=project_id,
        name=node.title,
        color=data.get("color", "#818cf8"),
        description=data.get("description"),
        decision_status=node.status or STATUS_PROPOSED,
        source=data.get("source"),
        created_at=node.created_at,
        supersedes=links.get(REL_SUPERSEDES, []),
        superseded_by=links.get("superseded_by", []),
        governs=links.get(REL_GOVERNS, []),
        requires=links.get(REL_REQUIRES, []),
        required_by=links.get("required_by", []),
        conflicts_with=links.get(REL_CONFLICTS_WITH, []),
    )


def links_map(db: Session, decision_ids) -> dict[str, dict[str, list[Node]]]:
    """Batch-load both relations for many decisions, in three queries.

    Batched for the same reason ADR-0094 batched ancestry: every caller is a list, and one
    request per row is how a page ends up not asking at all.
    """
    ids = set(decision_ids)
    result: dict[str, dict[str, list[Node]]] = defaultdict(lambda: defaultdict(list))
    if not ids:
        return result

    def _load(rel_type: str, own_side, other_side, key: str) -> None:
        rows = db.execute(
            select(own_side, Node)
            .join(Node, Node.id == other_side)
            .where(Edge.rel_type == rel_type, own_side.in_(ids))
            .order_by(Node.created_at.asc())
        ).all()
        for own_id, node in rows:
            result[own_id][key].append(node)

    _load(REL_SUPERSEDES, Edge.source_id, Edge.target_id, REL_SUPERSEDES)
    _load(REL_SUPERSEDES, Edge.target_id, Edge.source_id, "superseded_by")
    _load(REL_GOVERNS, Edge.source_id, Edge.target_id, REL_GOVERNS)
    _load(REL_REQUIRES, Edge.source_id, Edge.target_id, REL_REQUIRES)
    _load(REL_REQUIRES, Edge.target_id, Edge.source_id, "required_by")
    # Both directions land in one list. ``conflicts_with`` is symmetric in meaning and
    # directed in storage like every other edge, so a record reading only its own outgoing
    # edges would say "no conflicts" while the record it contradicts already says
    # otherwise — one of the two ends would be telling the truth and nothing would say
    # which. Deduped because a client may write the edge from both sides.
    _load(REL_CONFLICTS_WITH, Edge.source_id, Edge.target_id, REL_CONFLICTS_WITH)
    _load(REL_CONFLICTS_WITH, Edge.target_id, Edge.source_id, REL_CONFLICTS_WITH)
    for links in result.values():
        seen: set[str] = set()
        merged = []
        for node in links.get(REL_CONFLICTS_WITH, []):
            if node.id in seen:
                continue
            seen.add(node.id)
            merged.append(node)
        if merged:
            links[REL_CONFLICTS_WITH] = merged
    return result


def decisions(db: Session, *, project_id: str | None = None, status: str | None = None) -> list[DecisionView]:
    """Decision records, newest first, optionally narrowed by project or status."""
    query = db.query(Node).filter(Node.type == NODE_DECISION)
    nodes = query.order_by(Node.created_at.desc()).all()
    ids = [n.id for n in nodes]
    pmap = project_container_map(db, ids)
    lmap = links_map(db, ids)
    result: list[DecisionView] = []
    for node in nodes:
        pid = pmap.get(node.id)
        if project_id is not None and pid != project_id:
            continue
        if status is not None and (node.status or STATUS_PROPOSED) != status:
            continue
        result.append(_view(node, pid, lmap.get(node.id)))
    return result


def get_decision(db: Session, decision_id: str) -> DecisionView | None:
    node = db.get(Node, decision_id)
    if node is None or node.type != NODE_DECISION:
        return None
    pid = project_container_map(db, [decision_id]).get(decision_id)
    return _view(node, pid, links_map(db, [decision_id]).get(decision_id))


def create_decision(
    db: Session,
    project_id: str | None,
    *,
    name: str,
    color: str = "#818cf8",
    description: str | None = None,
    decision_status: str = STATUS_PROPOSED,
    source: str | None = None,
    actor: str | None = None,
) -> DecisionView:
    # Only the keys that carry a value: ``create_node`` folds every keyword into ``data``,
    # and a stored ``null`` shows up on the node page as an ad-hoc key the type does not
    # declare — noise that looks like data somebody wrote.
    fields = {"color": color, "description": description, "source": source, "status": decision_status}
    node = create_node(db, NODE_DECISION, title=name, actor=actor, **{k: v for k, v in fields.items() if v is not None})
    if project_id:
        add_edge(db, project_id, node.id, REL_CONTAINS)
    return _view(node, project_id)


# No ``update_decision`` / ``delete_decision`` here on purpose: a decision is a node, so
# editing and deleting one go through the generic node surface (ADR-0040→0043) the same way
# every other entity's do. A pair of helpers beside it would be the duplicate write path
# ADR-0087 spent its existence removing — and the first draft of this module had them,
# reachable from nothing.


def supersede(db: Session, decision_id: str, superseded_id: str, *, actor: str | None = None) -> None:
    """Record that ``decision_id`` replaces ``superseded_id``, and mark the older one.

    The edge and the status are one act. Left to a caller they are two writes that can
    half-succeed, and the half that fails silently is the one that leaves the status
    saying "replaced" with nothing naming the replacement — the exact state this ADR
    exists to end.
    """
    add_edge(db, decision_id, superseded_id, REL_SUPERSEDES, actor=actor)
    old = db.get(Node, superseded_id)
    old.status = STATUS_SUPERSEDED
    db.flush()


def unsupersede(db: Session, decision_id: str, superseded_id: str, *, actor: str | None = None) -> bool:
    """Drop a supersession. The far end returns to ``accepted``: it is a live decision again."""
    removed = remove_edge(db, decision_id, superseded_id, REL_SUPERSEDES, actor=actor)
    if not removed:
        return False
    old = db.get(Node, superseded_id)
    if old is not None and old.status == STATUS_SUPERSEDED:
        remaining = db.execute(
            select(Edge.id).where(Edge.target_id == superseded_id, Edge.rel_type == REL_SUPERSEDES)
        ).first()
        if remaining is None:
            old.status = "accepted"
            db.flush()
    return True


def governing(db: Session, node_id: str) -> list[DecisionView]:
    """The decisions that govern a piece of work — the read that had no query.

    ``labels_for_task`` existed from the start and its mirror never did, so "what was
    decided about this?" could only be answered by fetching every decision and filtering
    client-side, which is to say it was not answered anywhere.
    """
    rows = (
        db.execute(
            select(Node)
            .join(Edge, Edge.source_id == Node.id)
            .where(Edge.target_id == node_id, Edge.rel_type == REL_GOVERNS, Node.type == NODE_DECISION)
            .order_by(Node.created_at.desc())
        )
        .scalars()
        .all()
    )
    ids = [n.id for n in rows]
    pmap = project_container_map(db, ids)
    lmap = links_map(db, ids)
    return [_view(n, pmap.get(n.id), lmap.get(n.id)) for n in rows]


def assert_decision_write_shape(db: Session, node_type: str, fields: dict | None) -> None:
    """Refuse the two ways a decision write silently lands somewhere it will not be found.

    Both are the same defect wearing two dates. ADR-0118 moved a decision out of
    ``label`` + ``data.type="decision"`` and said the old shape would stop working
    "visibly"; it did not. ``POST /nodes`` with the old shape returns **201**, and what
    it creates is a label — invisible to ``decisions()`` (which filters on ``Node.type``)
    and, since ADR-0118 removed ``label_names``'s subtraction, a real entry in the label
    vocabulary. Production ran that way for two days and collected 17 records: the newest
    17 decisions in the database, none of them on the decisions page and all of them in
    the label picker. ADR-0130 moved the *status* to the ``nodes.status`` column, which
    opens the identical trap one field down — ``data.decision_status`` would be accepted
    as an inert key while the column, which is now what every decision surface reads,
    stayed NULL.

    So both are refused at the door, and the refusal names the shape that works. That is
    ADR-0078's rule: an agent always reads the error and does not always read the docs.
    """
    if not fields:
        return
    if node_type != NODE_DECISION and (
        fields.get("type") == NODE_DECISION or (node_type == NODE_LABEL and LEGACY_STATUS_KEY in fields)
    ):
        raise Unprocessable(
            f"a decision record is its own node type since ADR-0118: create it with "
            f"type='{NODE_DECISION}' instead of type='{node_type}' carrying "
            f"data.type='{NODE_DECISION}'. Written this way it is a label — it will not "
            f"appear on the decisions page and it will appear in the label vocabulary."
        )
    if node_type == NODE_DECISION and LEGACY_STATUS_KEY in fields:
        raise Unprocessable(
            f"a decision's state is the 'status' field, not data.{LEGACY_STATUS_KEY} "
            f"(ADR-0130). Send status='{fields[LEGACY_STATUS_KEY]}'; the response still "
            f"reports it as {LEGACY_STATUS_KEY}."
        )
