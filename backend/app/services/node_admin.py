"""Creating a node, for both doors (ADR-0040/0042/0085).

``POST /api/nodes`` and ``POST /api/v1/nodes`` are the single write surface for every
first-class entity, and they were two copies of it. Twenty lines each, near-verbatim:
the same type lookup, the same container/parent 404s with the same wording, the same
``model_dump(exclude=...)`` plus ``data`` merge, the same create-then-link-then-dispatch
order, and a ``_node_write_out`` helper defined once per file.

Nothing was broken, which is the state ADR-0070 warns about — a duplicate that still
works has no failure symptom, and CLAUDE.md states "one service both routers call" as a
governing principle in six places while this, the surface it calls canonical, was not
one. The audit that produced this change found the two copies had *not* drifted; that
is luck, not a property, and it is only luck until someone fixes a validation on one
door.

What stays in the routers is what genuinely differs: the v1 door checks the API key's
scope and whether the key may file into that container, and it passes an actor. The
act itself lives here and raises ``ServiceError`` so both doors render the same refusal
without either writing one.
"""

from sqlalchemy.orm import Session

from app.models import Node, NodeType
from app.schemas import NodeCreate, NodeOut
from app.services import graph
from app.services.enrichment import enrich_task
from app.services.errors import NotFound, Unprocessable
from app.services.graph_dispatch import dispatch_node_created


def write_out(db: Session, node: Node):
    """Enriched ``TaskOut`` for task-role nodes, else ``NodeOut``.

    A task read back from a write carries what the retired ``/projects/{id}/tasks``
    routes returned — ``project_id``, subtask and comment counts, dependency lists —
    so a caller does not need a second request to learn what it just created.
    """
    if node.type in graph.task_type_keys(db):
        return enrich_task(graph.get_task(db, node.id), db)
    return NodeOut.model_validate(node)


def validate_containment(db: Session, container_id: str | None, parent_id: str | None) -> None:
    """Refuse bogus containment hints *before* anything is created.

    Order matters: creating the node first and then discovering the container does not
    exist leaves a phantom node and a dangling edge behind. Mirrors the 404 contract of
    the task routes this surface replaced.
    """
    if container_id is not None and db.get(Node, container_id) is None:
        raise NotFound("Container not found")
    if parent_id is not None:
        parent = graph.get_task(db, parent_id)
        in_scope = container_id is None or parent_id in graph.contained_task_ids(db, container_id)
        if parent is None or not in_scope:
            raise NotFound("Parent task not found")


async def create(
    db: Session,
    body: NodeCreate,
    *,
    actor: str | None = None,
    source: str = "node",
) -> Node:
    """Create a node, file it, and run the role-driven reactions. Commits.

    The caller has already decided whether it is *allowed* to — v1 checks scope and
    container access first. This is the act, not the permission.
    """
    if db.get(NodeType, body.type) is None:
        raise Unprocessable(f"unknown node type '{body.type}'")
    validate_containment(db, body.container_id, body.parent_id)

    fields = body.model_dump(exclude={"type", "title", "data", "container_id", "parent_id"}, exclude_none=True)
    if body.data:
        fields.update(body.data)
    # A write whose shape means "decision" must actually make one (ADR-0130). Checked
    # after the merge because the old shape can arrive in ``data`` or, since NodeCreate
    # allows extras, flat beside it — both fold into the same bag.
    graph.assert_decision_write_shape(db, body.type, fields)
    node = graph.create_node(db, body.type, title=body.title, **fields)

    # Containment before dispatch, so the task pipeline can resolve the node's project
    # (its nearest container ancestor) for activity and notifications. A subtask gets
    # both a container and a parent `contains` edge (ADR-0032).
    #
    # These edges are deliberately not dispatched: creation-time containment is an
    # input to the node event, not a second event. Dispatching them logs a membership
    # *change* for a node that was created there, which test_edge_dispatch pins at
    # exactly one entry. See the EDGE_ALLOWED note in test_task_pipeline_guard.
    for edge_source in (body.container_id, body.parent_id):
        if edge_source is not None:
            graph.add_edge(db, edge_source, node.id, graph.REL_CONTAINS)

    await dispatch_node_created(db, node, actor=actor, source=source)
    db.refresh(node)
    return node
