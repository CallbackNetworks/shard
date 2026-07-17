"""REST API for the node/edge type registries (ADR-0033 Phase A).

Lets users inspect the built-in vocabulary and define their own node types (new
logical layers) and edge types (new relationships). Built-in types are protected:
their key cannot be deleted and their built-in flag is immutable. A custom type
cannot be deleted while nodes/edges of that type still exist.
"""

from fastapi import APIRouter, Depends, HTTPException, status
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

router = APIRouter(prefix="/graph-types", tags=["graph-types"])


# --- Node types --------------------------------------------------------------


@router.get("/nodes", response_model=list[NodeTypeOut])
def list_node_types(db: Session = Depends(get_db)):
    return db.query(NodeType).order_by(NodeType.is_builtin.desc(), NodeType.key).all()


@router.post("/nodes", response_model=NodeTypeOut, status_code=status.HTTP_201_CREATED)
def create_node_type(body: NodeTypeCreate, db: Session = Depends(get_db)):
    if db.get(NodeType, body.key) is not None:
        raise HTTPException(status_code=409, detail=f"node type '{body.key}' already exists")
    nt = NodeType(is_builtin=False, **body.model_dump())
    db.add(nt)
    db.commit()
    db.refresh(nt)
    return nt


@router.patch("/nodes/{key}", response_model=NodeTypeOut)
def update_node_type(key: str, body: NodeTypeUpdate, db: Session = Depends(get_db)):
    nt = db.get(NodeType, key)
    if nt is None:
        raise HTTPException(status_code=404, detail="node type not found")
    for field, value in body.model_dump(exclude_unset=True).items():
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
    return db.query(EdgeType).order_by(EdgeType.is_builtin.desc(), EdgeType.key).all()


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
    for field, value in body.model_dump(exclude_unset=True).items():
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
