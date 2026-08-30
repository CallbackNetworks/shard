"""REST API for the node/edge type registries (ADR-0033 Phase A).

Lets users inspect the built-in vocabulary and define their own node types (new
logical layers) and edge types (new relationships). Built-in types are protected:
their key cannot be deleted and their built-in flag is immutable. A custom type
cannot be deleted while nodes/edges of that type still exist.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
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


@router.get("/fields/vocabulary")
def field_vocabulary():
    """Everything a field declaration may say, from the code that enforces it (ADR-0132).

    Served rather than mirrored in the client: a second copy of a vocabulary is how the
    rules editor ended up offering values the engine rejected (ADR-0056) and how the
    rule-name list drifted (ADR-0058).

    ``managed`` are the keys of a node's ``data`` that belong to a feature rather than to
    the user (ADR-0074) — the field editor needs them to tell machinery apart from a key
    somebody wrote by hand, and it must be the same list the write guard enforces.
    ``kinds`` / ``stores`` / ``columns`` are what the *declaration* may contain, and they
    are here for the same reason one step earlier: until ADR-0132 no UI could declare a
    field at all, so a custom type's editor was permanently empty and the vocabulary had
    nowhere to be read. ``columns`` matters most — a ``column`` field naming anything
    outside it is written into ``data`` under the same name, which looks saved and
    changes nothing.
    """
    from app.services.graph_registry import FIELD_KINDS, FIELD_STORES, MANAGED_DATA_KEYS

    return {
        "managed": sorted(set(MANAGED_DATA_KEYS) | set(node_data.DERIVED)),
        "kinds": list(FIELD_KINDS),
        "stores": list(FIELD_STORES),
        "columns": sorted(graph.WRITABLE_COLUMNS),
    }


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
    return type_registry.edge_types_with_usage(db)


@router.post("/edges", response_model=EdgeTypeOut, status_code=status.HTTP_201_CREATED)
def create_edge_type(body: EdgeTypeCreate, db: Session = Depends(get_db)):
    return _registry(lambda: type_registry.create_edge_type(db, body))


@router.patch("/edges/{key}", response_model=EdgeTypeOut)
def update_edge_type(key: str, body: EdgeTypeUpdate, db: Session = Depends(get_db)):
    return _registry(lambda: type_registry.update_edge_type(db, key, body))


@router.delete("/edges/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_edge_type(key: str, db: Session = Depends(get_db)):
    _registry(lambda: type_registry.delete_edge_type(db, key))
