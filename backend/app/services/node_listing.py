"""One node listing rule, for both doors (ADR-0153).

``GET /api/nodes`` and ``GET /api/v1/nodes`` were two hand-written copies of the same
query — the same type filter, the same ``title.ilike`` — and they had already drifted:
the internal one grew ``unfiled`` and ``offset`` when ADR-0150 rebuilt the explorer and
the external one did not, so an agent could not ask the question the page asks. That is
the ADR-0070/0087 shape, and the fix is the same one: the filter *is* the service, and
each router adds only what genuinely differs (v1 narrows by the key's reach).

Three things the copies could not do, and the page needed:

``sort``
    Both ordered by ``position, created_at`` and offered no alternative, so "the node I
    just made" sorted *last* and, past the first page, was unreachable by any means but
    knowing its title. On a page whose subject is the data itself, recency is the
    default question.

``status``
    ``nodes.status`` is on every row and on ``NodeOut``, and neither door could narrow
    by it. Note ``none``: NULL is a real state here (ADR-0141's overdue disagreement
    came from exactly those rows), so a filter that cannot name it hides the set most
    worth looking at.

id search
    ``query`` matched titles only, while the explorer prints ``type · id`` in the pane
    beside the search box. Pasting what the page just showed you found nothing. The id
    match is a prefix and applies only from ``ID_QUERY_MIN`` characters — a one-letter
    term must not drag in every node whose uuid happens to start with it.
"""

from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session

from app.models import Node
from app.services import graph
from app.services.errors import Unprocessable

# Short enough for a truncated id, long enough that a real title search never trips it.
ID_QUERY_MIN = 8

# The value a caller sends to mean "status is NULL". Not an empty string: an omitted
# filter and a filter for the absent value are different questions and a blank cannot
# tell them apart.
NULL_STATUS = "none"

SORTS = ("position", "recent", "created", "title")
DEFAULT_SORT = "position"


def _order(q: Query, sort: str) -> Query:
    if sort == "recent":
        return q.order_by(Node.updated_at.desc(), Node.created_at.desc())
    if sort == "created":
        return q.order_by(Node.created_at.desc())
    if sort == "title":
        # Lowered rather than raw: SQLite's default collation is case-sensitive and
        # PostgreSQL's is not, so the unlowered order differs between the two targets
        # the suite treats as co-equal (ADR-0018).
        return q.order_by(func.lower(Node.title), Node.created_at)
    return q.order_by(Node.position, Node.created_at)


def parse_statuses(status: str | None) -> list[str | None] | None:
    """``"todo,none"`` -> ``["todo", None]``. ``None``/empty means "no status filter"."""
    if not status:
        return None
    values: list[str | None] = []
    for raw in status.split(","):
        value = raw.strip()
        if not value:
            continue
        values.append(None if value == NULL_STATUS else value)
    return values or None


def listing_query(
    db: Session,
    *,
    type: str | None = None,
    query: str | None = None,
    status: str | None = None,
    unfiled: bool = False,
    sort: str = DEFAULT_SORT,
    apply_status: bool = True,
    apply_unfiled: bool = True,
) -> Query:
    """The filtered, ordered node query. Callers add their own scope, offset and limit.

    The two ``apply_*`` flags are what the facet counts use: a count beside a filter has
    to be the size of the set you would get *by switching to* it, so it is computed with
    every other narrowing applied and that one left off. Applied, each count would
    collapse to whatever is already selected and there would be nothing to switch to.
    """
    if sort not in SORTS:
        raise Unprocessable(f"unknown sort '{sort}' — one of {', '.join(SORTS)}")

    q = db.query(Node)
    if type is not None:
        q = q.filter(Node.type == type)
    if query:
        term = query.strip()
        title_match = Node.title.ilike(f"%{term}%")
        # An id is what this page hands you; being unable to hand it back was the gap.
        q = q.filter(or_(title_match, Node.id.ilike(f"{term}%")) if len(term) >= ID_QUERY_MIN else title_match)
    if unfiled and apply_unfiled:
        q = q.filter(Node.id.in_(graph.unfiled_node_ids(db)))
    if apply_status:
        wanted = parse_statuses(status)
        if wanted is not None:
            clauses = [Node.status.is_(None) if v is None else Node.status == v for v in wanted]
            q = q.filter(or_(*clauses))
    return _order(q, sort)


def facets(
    db: Session,
    *,
    type: str | None = None,
    query: str | None = None,
    status: str | None = None,
    unfiled: bool = False,
) -> dict:
    """How many rows match, and what states they are in.

    The count is the whole point. Without it the page could only say "at least this
    many" — ADR-0150 removed one lie of that shape (drawing a capped page and printing
    its length as the total) and left the narrowed case guessing, because a filtered
    set had no denominator anywhere. ``total`` is the real one, so paging knows where
    it ends instead of inferring it from a full page.

    ``status`` is served rather than mirrored in the client (ADR-0056). There is no
    fixed vocabulary to mirror: a task is todo/in_progress/done/failed, a project is
    active/archived, a decision is proposed/accepted/deprecated/superseded, and a
    custom type's states are whatever has been written. Counting the actual column is
    the only answer that stays true for a type nobody has told the app about.

    ``loose`` is counted the same way and for the same reason (ADR-0154). It was a
    checkbox in a section of its own carrying no number, so the only way to learn
    whether anything was loose was to tick it — on the one filter whose entire job is to
    surface things you did not know were there. And it is not derivable from the edge
    count now drawn on each row: of the 32 loose nodes in this database, 11 have no
    edges at all and 21 have exactly one, an ``owns`` from an identity. Those 21 —
    owned by somebody, filed by nobody — are indistinguishable from healthy nodes in
    that column, and they are the half worth finding.
    """
    base = listing_query(db, type=type, query=query, status=status, unfiled=unfiled, apply_status=False)
    counted = base.order_by(None).with_entities(Node.status, func.count(Node.id)).group_by(Node.status).all()
    by_status = [
        {"value": value, "count": count} for value, count in sorted(counted, key=lambda row: (-row[1], row[0] or ""))
    ]
    total = listing_query(db, type=type, query=query, status=status, unfiled=unfiled).order_by(None).count()
    loose = listing_query(db, type=type, query=query, status=status, unfiled=True).order_by(None).count()
    return {"total": total, "status": by_status, "loose": loose}
