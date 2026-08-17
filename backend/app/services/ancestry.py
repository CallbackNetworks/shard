"""Where a node lives, for both doors (ADR-0094).

The graph has always known that a project sits under an identity which sits under an
organization — ``contains`` is the aggregation skeleton and ``all_focus_targets`` already
walks it *downward* to decide what a focus narrows to. Nothing ever walked it *upward* for
display, so every page that shows one node showed it as if it were a root: the project page
never said whose project it is, and a linked identity reached the screen only as a colour.

Two axes, never merged (ADR-0078). ``trails`` follow ``contains`` — where the node lives —
and there may be several, because a node may have several parents; that is the multi-parent
graph the product has had since ADR-0032 and never drew. ``owners`` are the ``owns`` sources
— whose it is. Folding the second into the first would make ownership look like a level of
containment, which is exactly the confusion those two relations exist to prevent.

Batched by id on purpose: the dashboard asks for every project it is about to draw. One
endpoint answering one node would have made "who owns these 38 projects" 38 requests, which
is how a page ends up not asking at all.
"""

from collections import defaultdict

from sqlalchemy.orm import Session

from app.models import Edge, Node, NodeType
from app.schemas import AncestryOut, AncestryRef
from app.services.graph import REL_CONTAINS, REL_OWNS

# A trail is a breadcrumb, not a report: past a handful of parents the strip stops being
# readable, and the caps also bound a walk over data nobody has validated the shape of.
MAX_TRAILS = 8
MAX_DEPTH = 16
# How many nodes one request may ask about. Lives here, not in a router, so both doors
# cut the list at the same place.
MAX_IDS = 200


def _ref(node: Node, type_rows: dict[str, NodeType]) -> AncestryRef:
    nt = type_rows.get(node.type)
    data = node.data or {}
    return AncestryRef(
        id=node.id,
        type=node.type,
        # The engine name is never the user's name (ADR-0058): the label is drawn
        # server-side from the registry so the client holds no second vocabulary.
        type_label=nt.label if nt else node.type,
        title=node.title,
        color=data.get("color") or (nt.color if nt else None),
    )


def _walk_up(db: Session, start_ids: set[str]) -> tuple[dict[str, list[tuple[str, str]]], dict[str, Node]]:
    """Parent edges above ``start_ids``, one query per *level* rather than per node.

    Returns ``{child_id: [(parent_id, rel_type), ...]}`` plus the nodes it touched.
    Ordered by ``(position, created_at)`` so "first parent" is the same pick compat
    ``project_id`` makes — a trail must not reorder itself between reads.
    """
    parents: dict[str, list[tuple[str, str]]] = defaultdict(list)
    nodes: dict[str, Node] = {}
    frontier = set(start_ids)
    seen: set[str] = set(start_ids)
    for _ in range(MAX_DEPTH):
        if not frontier:
            break
        edges = (
            db.query(Edge)
            .filter(Edge.target_id.in_(frontier), Edge.rel_type.in_((REL_CONTAINS, REL_OWNS)))
            .order_by(Edge.position, Edge.created_at)
            .all()
        )
        if not edges:
            break
        for e in edges:
            parents[e.target_id].append((e.source_id, e.rel_type))
        next_ids = {e.source_id for e in edges}
        for node in db.query(Node).filter(Node.id.in_(next_ids)).all():
            nodes[node.id] = node
        frontier = next_ids - seen
        seen |= next_ids
    return parents, nodes


def ancestry_for(
    db: Session,
    node_ids: list[str],
    *,
    visible=None,
) -> dict[str, AncestryOut]:
    """Containment trails and owners for each requested node.

    Ids that do not resolve to a node are simply absent from the result — this answers
    "where do these live", and a batch must not fail because one member was deleted.
    ``visible`` filters which ancestors may be named, so a project-scoped API key does
    not learn the titles of containers it cannot otherwise read.
    """
    wanted = [i for i in dict.fromkeys(node_ids) if i]
    if not wanted:
        return {}
    subjects = {n.id: n for n in db.query(Node).filter(Node.id.in_(wanted)).all()}
    if not subjects:
        return {}

    parents, nodes = _walk_up(db, set(subjects))
    nodes.update(subjects)
    type_rows = {nt.key: nt for nt in db.query(NodeType).all()}

    def allowed(node: Node) -> bool:
        return visible is None or visible(node)

    def trails_for(node_id: str) -> tuple[list[list[AncestryRef]], bool]:
        """Every ``contains`` path above ``node_id``, root-first, direct parent last."""
        out: list[list[AncestryRef]] = []
        truncated = False

        def climb(current: str, below: list[AncestryRef], depth: int) -> None:
            nonlocal truncated
            up = [(pid, rel) for pid, rel in parents.get(current, []) if rel == REL_CONTAINS]
            up = [(pid, rel) for pid, rel in up if pid in nodes and allowed(nodes[pid])]
            if not up or depth >= MAX_DEPTH:
                if below:
                    out.append(list(reversed(below)))
                if up:
                    truncated = True
                return
            for pid, _rel in up:
                if len(out) >= MAX_TRAILS:
                    truncated = True
                    return
                if any(ref.id == pid for ref in below):  # defensive: contains is acyclic
                    continue
                climb(pid, [*below, _ref(nodes[pid], type_rows)], depth + 1)

        climb(node_id, [], 0)
        return out, truncated

    result: dict[str, AncestryOut] = {}
    for node_id, node in subjects.items():
        if not allowed(node):
            continue
        trails, truncated = trails_for(node_id)
        owners = [
            _ref(nodes[pid], type_rows)
            for pid, rel in parents.get(node_id, [])
            if rel == REL_OWNS and pid in nodes and allowed(nodes[pid])
        ]
        result[node_id] = AncestryOut(id=node_id, trails=trails, owners=owners, truncated=truncated)
    return result
