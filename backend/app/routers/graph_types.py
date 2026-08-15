"""REST API for the node/edge type registries (ADR-0033 Phase A).

Lets users inspect the built-in vocabulary and define their own node types (new
logical layers) and edge types (new relationships). Built-in types are protected:
their key cannot be deleted and their built-in flag is immutable. A custom type
cannot be deleted while nodes/edges of that type still exist.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Edge, EdgeType, NodeType
from app.schemas import (
    EdgeTypeCreate,
    EdgeTypeOut,
    EdgeTypeUpdate,
    NodeTypeCreate,
    NodeTypeOut,
    NodeTypeUpdate,
)
from app.services import graph, node_data
from app.services import graph_registry as type_registry

router = APIRouter(prefix="/graph-types", tags=["graph-types"])


def _registry(call):
    """Run a registry operation, reporting its refusal as HTTP.

    The rules live in ``graph_registry`` because the same registry is also reachable
    through ``/api/v1/node-types`` (ADR-0079), and a guard enforced at only one door
    is not a guard.
    """
    try:
        return call()
    except type_registry.TypeRegistryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


# --- Node types --------------------------------------------------------------


@router.get("/nodes", response_model=list[NodeTypeOut])
def list_node_types(db: Session = Depends(get_db)):
    return type_registry.node_types_with_usage(db)


@router.get("/data-keys/managed")
def list_managed_data_keys():
    """Keys of a node's ``data`` that belong to a feature, not to the user (ADR-0074).

    Served rather than mirrored in the client: a second copy of a vocabulary is how the
    rules editor ended up offering values the engine rejected (ADR-0056) and how the
    rule-name list drifted (ADR-0058). The field editor needs this to tell the third
    bucket — machinery — apart from a key somebody wrote by hand, and it must be the
    same list the write guard enforces.
    """
    from app.services.graph_registry import MANAGED_DATA_KEYS

    return {"keys": sorted(set(MANAGED_DATA_KEYS) | set(node_data.DERIVED))}


@router.post("/nodes", response_model=NodeTypeOut, status_code=status.HTTP_201_CREATED)
def create_node_type(body: NodeTypeCreate, db: Session = Depends(get_db)):
    return _registry(lambda: type_registry.create_node_type(db, body))


@router.patch("/nodes/{key}", response_model=NodeTypeOut)
def update_node_type(key: str, body: NodeTypeUpdate, db: Session = Depends(get_db)):
    return _registry(lambda: type_registry.update_node_type(db, key, body))


@router.delete("/nodes/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node_type(key: str, db: Session = Depends(get_db)):
    _registry(lambda: type_registry.delete_node_type(db, key))


# --- Edge types --------------------------------------------------------------


@router.get("/edges", response_model=list[EdgeTypeOut])
def list_edge_types(db: Session = Depends(get_db)):
    types = db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()
    counts = dict(db.query(Edge.rel_type, func.count(Edge.id)).group_by(Edge.rel_type).all())
    for et in types:
        et.usage_count = counts.get(et.key, 0)
    return types


def _check_endpoint_rules(db: Session, body) -> None:
    """Reject an endpoint declaration naming a role or node type that does not exist.

    A rule carrying a typo constrains nothing and says nothing about why — the same
    silent-empty-set trap ADR-0056 closed for condition values, applied to ADR-0078's
    endpoint declarations.
    """
    known_types = {key for (key,) in db.query(NodeType.key).all()}
    for side in ("allowed_source", "allowed_target"):
        rule = getattr(body, side, None)
        if rule is None:
            continue
        unknown_roles = [r for r in rule.roles if r not in graph.ROLES]
        if unknown_roles:
            raise HTTPException(status_code=422, detail=f"{side}: unknown role(s) {', '.join(unknown_roles)}")
        unknown_types = [t for t in rule.types if t not in known_types]
        if unknown_types:
            raise HTTPException(status_code=422, detail=f"{side}: unknown node type(s) {', '.join(unknown_types)}")


@router.post("/edges", response_model=EdgeTypeOut, status_code=status.HTTP_201_CREATED)
def create_edge_type(body: EdgeTypeCreate, db: Session = Depends(get_db)):
    if db.get(EdgeType, body.key) is not None:
        raise HTTPException(status_code=409, detail=f"edge type '{body.key}' already exists")
    _check_endpoint_rules(db, body)
    et = EdgeType(is_builtin=False, **body.model_dump())
    db.add(et)
    db.commit()
    db.refresh(et)
    return et


@router.patch("/edges/{key}", response_model=EdgeTypeOut)
def update_edge_type(key: str, body: EdgeTypeUpdate, db: Session = Depends(get_db)):
    et = db.get(EdgeType, key)
    if et is None:
        raise HTTPException(status_code=404, detail="edge type not found")
    _check_endpoint_rules(db, body)
    fields = body.model_dump(exclude_unset=True)
    # Built-in structural flags are immutable — mirroring the node-type role
    # guard: flipping contains' is_containment would collapse the containment
    # pipeline (project/task membership, structure map, unfiled detection).
    if et.is_builtin and ("is_containment" in fields or "is_symmetric" in fields):
        raise HTTPException(status_code=400, detail="cannot change structural flags of a built-in edge type")
    for field, value in fields.items():
        setattr(et, field, value)
    db.commit()
    db.refresh(et)
    return et


@router.delete("/edges/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_edge_type(key: str, db: Session = Depends(get_db)):
    et = db.get(EdgeType, key)
    if et is None:
        raise HTTPException(status_code=404, detail="edge type not found")
    if et.is_builtin:
        raise HTTPException(status_code=400, detail="cannot delete a built-in edge type")
    if db.query(Edge.id).filter(Edge.rel_type == key).first() is not None:
        raise HTTPException(status_code=409, detail="edge type is still in use by existing edges")
    db.delete(et)
    db.commit()
