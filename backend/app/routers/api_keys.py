import hashlib
import secrets
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Node
from app.schemas import AgentTaskSummary, ApiKeyCreate, ApiKeyCreateOut, ApiKeyOut, ApiKeyUpdate, LabelOut, TaskOut
from app.services import graph

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _generate_key() -> str:
    return f"tdp_{secrets.token_hex(24)}"


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


@router.get("", response_model=list[ApiKeyOut])
def list_api_keys(db: Session = Depends(get_db)):
    keys = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()
    return [ApiKeyOut.from_model(k) for k in keys]


@router.post("", response_model=ApiKeyCreateOut, status_code=status.HTTP_201_CREATED)
def create_api_key(body: ApiKeyCreate, db: Session = Depends(get_db)):
    raw_key = _generate_key()
    api_key = ApiKey(
        name=body.name,
        key=None,
        key_hash=_hash_key(raw_key),
        key_last4=raw_key[-4:],
        project_id=body.project_id,
        scopes=body.scopes,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    out = ApiKeyOut.from_model(api_key)
    return ApiKeyCreateOut(**out.model_dump(), key=raw_key)


@router.patch("/{key_id}", response_model=ApiKeyOut)
def update_api_key(key_id: str, body: ApiKeyUpdate, db: Session = Depends(get_db)):
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(api_key, field, value)
    db.commit()
    db.refresh(api_key)
    return ApiKeyOut.from_model(api_key)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_api_key(key_id: str, db: Session = Depends(get_db)):
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(api_key)
    db.commit()


@router.get("/agents/summary", response_model=list[AgentTaskSummary])
def get_agent_summary(db: Session = Depends(get_db)):
    """Return workload summary for each API key (agent), including task counts and tasks."""
    keys = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()
    if not keys:
        return []

    key_ids = [k.id for k in keys]

    # ``assigned_agent_key_id`` lives in node.data (JSON, not indexed) so scan task
    # nodes and filter in Python (ADR-0033, node-only tasks).
    key_id_set = set(key_ids)
    all_tasks = [
        graph.task_view(n, db)
        for n in db.query(Node).filter(Node.type == graph.NODE_TASK).all()
        if (n.data or {}).get("assigned_agent_key_id") in key_id_set
    ]

    # Batch-load dependency, label, and subtask edges for every agent task (ADR-0032).
    _all_ids = [t.id for t in all_tasks]
    blocked_by_map, blocking_map = graph.dependency_maps(db, _all_ids)
    labels_by_task = graph.labels_map(db, _all_ids)
    subtasks_by_task = graph.child_task_ids_map(db, _all_ids)

    # Group tasks by agent key in Python — no further DB round-trips.
    tasks_by_key: dict[str, list] = defaultdict(list)
    for t in all_tasks:
        tasks_by_key[t.assigned_agent_key_id].append(t)

    result = []
    for key in keys:
        tasks = tasks_by_key.get(key.id, [])
        counts: dict[str, int] = {"todo": 0, "in_progress": 0, "done": 0, "failed": 0}
        enriched_tasks = []
        for t in tasks:
            counts[t.status] += 1
            out = TaskOut.model_validate(t)
            out.labels = [LabelOut.model_validate(lb) for lb in labels_by_task.get(t.id, [])]
            out.subtask_count = len(subtasks_by_task.get(t.id, []))
            out.comment_count = len(t.comments)
            out.blocked_by = blocked_by_map.get(t.id, [])
            out.blocking = blocking_map.get(t.id, [])
            out.assigned_agent_name = key.name
            enriched_tasks.append(out)
        result.append(
            AgentTaskSummary(
                agent_id=key.id,
                agent_name=key.name,
                project_id=key.project_id,
                active=key.active,
                last_used_at=key.last_used_at,
                task_counts=counts,
                tasks=enriched_tasks,
            )
        )
    return result
