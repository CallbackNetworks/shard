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
from app.models import Edge, EdgeType, Node, NodeType
from app.schemas import (
    EdgeTypeCreate,
    EdgeTypeOut,
    EdgeTypeUpdate,
    NodeTypeCreate,
    NodeTypeOut,
    NodeTypeUpdate,
)
from app.services import graph, node_data

router = APIRouter(prefix="/graph-types", tags=["graph-types"])

# Roles whose membership is frozen on built-in types: flipping project's ``container``
# or task's ``task`` role would collapse the compat/enrichment pipeline (ADR-0034/0035).
_IMMUTABLE_BUILTIN_ROLES = {graph.ROLE_CONTAINER, graph.ROLE_TASK}


# --- Node types --------------------------------------------------------------


@router.get("/nodes", response_model=list[NodeTypeOut])
def list_node_types(db: Session = Depends(get_db)):
    types = db.query(NodeType).order_by(NodeType.is_builtin.desc(), NodeType.key).all()
    counts = dict(db.query(Node.type, func.count(Node.id)).group_by(Node.type).all())
    for nt in types:
        nt.usage_count = counts.get(nt.key, 0)
    return types


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
    if db.get(NodeType, body.key) is not None:
        raise HTTPException(status_code=409, detail=f"node type '{body.key}' already exists")
    nt = NodeType(
        is_builtin=False,
        key=body.key,
        label=body.label,
        icon=body.icon,
        color=body.color,
        data=body.data,
        roles=sorted(set(body.roles)) if body.roles else None,
        # A type may declare which keys of its nodes' ``data`` are the user's (ADR-0074).
        fields=[f.model_dump(exclude_none=True) for f in body.fields] if body.fields else None,
    )
    db.add(nt)
    db.commit()
    db.refresh(nt)
    return nt


@router.patch("/nodes/{key}", response_model=NodeTypeOut)
def update_node_type(key: str, body: NodeTypeUpdate, db: Session = Depends(get_db)):
    nt = db.get(NodeType, key)
    if nt is None:
        raise HTTPException(status_code=404, detail="node type not found")
    # Named ``patch``, not ``fields``: ``fields`` is now a column of its own (ADR-0074).
    patch = body.model_dump(exclude_unset=True, exclude_none=False)
    if "roles" in patch:
        new_roles = set(patch.pop("roles") or [])
        # Built-in container/task membership is immutable (ADR-0034/0035): reject a
        # change to those roles.
        if nt.is_builtin and (
            {r for r in new_roles if r in _IMMUTABLE_BUILTIN_ROLES}
            != {r for r in (nt.roles or []) if r in _IMMUTABLE_BUILTIN_ROLES}
        ):
            raise HTTPException(status_code=400, detail="cannot change roles of a built-in node type")
        nt.roles = sorted(new_roles) or None
    if "fields" in patch:
        declared = patch.pop("fields")
        nt.fields = [{k: v for k, v in f.items() if v is not None} for f in declared] if declared else None
    for field, value in patch.items():
        setattr(nt, field, value)
    db.commit()
    db.refresh(nt)
    return nt


@router.delete("/nodes/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node_type(key: str, db: Session = Depends(get_db)):
    nt = db.get(NodeType, key)
    if nt is None:
        raise HTTPException(status_code=404, detail="node type not found")
    if nt.is_builtin:
        raise HTTPException(status_code=400, detail="cannot delete a built-in node type")
    if db.query(Node.id).filter(Node.type == key).first() is not None:
        raise HTTPException(status_code=409, detail="node type is still in use by existing nodes")
    db.delete(nt)
    db.commit()


# --- Edge types --------------------------------------------------------------


@router.get("/edges", response_model=list[EdgeTypeOut])
def list_edge_types(db: Session = Depends(get_db)):
    types = db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()
    counts = dict(db.query(Edge.rel_type, func.count(Edge.id)).group_by(Edge.rel_type).all())
    for et in types:
        et.usage_count = counts.get(et.key, 0)
    return types


@router.post("/edges", response_model=EdgeTypeOut, status_code=status.HTTP_201_CREATED)
def create_edge_type(body: EdgeTypeCreate, db: Session = Depends(get_db)):
    if db.get(EdgeType, body.key) is not None:
        raise HTTPException(status_code=409, detail=f"edge type '{body.key}' already exists")
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
