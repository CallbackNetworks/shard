import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog
from app.routers.deps import get_identity_or_404, get_project_or_404
from app.schemas import IdentityCreate, IdentityHubOut, IdentityOut, IdentityUpdate
from app.services import graph

router = APIRouter(prefix="/identities", tags=["identities"])


def _enrich(identity: graph.IdentityView, db: Session) -> IdentityOut:
    out = IdentityOut.model_validate(identity)
    out.project_count = len(graph.project_ids_for_identity(db, identity.id))
    out.share_pin_set = identity.share_pin_hash is not None
    out.share_expires_at = identity.share_expires_at
    return out


@router.get("", response_model=list[IdentityOut])
def list_identities(db: Session = Depends(get_db)):
    return [_enrich(i, db) for i in graph.all_identities(db)]


@router.get("/hub-stats", response_model=IdentityHubOut)
def get_hub_stats(db: Session = Depends(get_db)):
    now = datetime.now(UTC)
    year_ago = now - timedelta(days=365)

    identities = graph.all_identities(db)
    totals = {"total_tasks": 0, "done": 0, "in_progress": 0, "todo": 0, "failed": 0, "overdue": 0}
    result = []

    for ident in identities:
        ident_project_ids = graph.project_ids_for_identity(db, ident.id)
        projects_data = []
        ident_stats = {"total_tasks": 0, "done": 0, "in_progress": 0, "todo": 0, "failed": 0, "overdue": 0}

        if ident_project_ids:
            projects = graph.projects_by_ids(db, ident_project_ids).values()
            for p in projects:
                p_stats = {"total_tasks": 0, "done": 0, "in_progress": 0, "todo": 0, "failed": 0, "overdue": 0}
                for t in graph.tasks_in_project(db, p.id):
                    p_stats["total_tasks"] += 1
                    if t.status in p_stats:
                        p_stats[t.status] += 1
                    if (
                        t.due_date
                        and t.due_date.replace(tzinfo=None) < now.replace(tzinfo=None)
                        and t.status not in ("done", "failed")
                    ):
                        p_stats["overdue"] += 1
                projects_data.append({"id": p.id, "name": p.name, "status": p.status, **p_stats})
                for k in ident_stats:
                    ident_stats[k] += p_stats[k]

            day_col = func.date(ActivityLog.created_at).label("day")
            daily = (
                db.query(day_col, func.count(ActivityLog.id).label("count"))
                .filter(
                    ActivityLog.project_id.in_(ident_project_ids),
                    ActivityLog.created_at >= year_ago,
                )
                .group_by(day_col)
                .order_by(day_col)
                .all()
            )
            daily_activity = [{"date": str(r.day), "count": r.count} for r in daily]
        else:
            daily_activity = []

        for k in totals:
            totals[k] += ident_stats[k]

        result.append(
            {
                "id": ident.id,
                "name": ident.name,
                "color": ident.color,
                "avatar": ident.avatar,
                **ident_stats,
                "projects": projects_data,
                "daily_activity": daily_activity,
            }
        )

    return {"identities": result, "totals": totals}


@router.post("", response_model=IdentityOut, status_code=status.HTTP_201_CREATED)
def create_identity(body: IdentityCreate, db: Session = Depends(get_db)):
    identity = graph.create_identity(db, **body.model_dump())
    db.commit()
    return _enrich(identity, db)


@router.patch("/{identity_id}", response_model=IdentityOut)
def update_identity(identity_id: str, body: IdentityUpdate, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    identity = graph.update_identity(db, identity_id, **body.model_dump(exclude_none=True))
    db.commit()
    return _enrich(identity, db)


@router.post("/{identity_id}/rotate-share-token")
def rotate_share_token(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    token = str(uuid.uuid4())
    graph.update_identity(db, identity_id, share_token=token)
    db.commit()
    return {"share_token": token}


@router.delete("/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_identity(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    graph.delete_identity(db, identity_id)
    db.commit()


# ── Project ↔ Identity linking ────────────────────────────────────


@router.post("/{identity_id}/projects/{project_id}", status_code=status.HTTP_201_CREATED)
def link_project(identity_id: str, project_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    get_project_or_404(project_id, db)
    if project_id in graph.project_ids_for_identity(db, identity_id):
        return {"status": "already linked"}
    graph.link_membership(db, identity_id, project_id)
    db.commit()
    return {"status": "linked"}


@router.delete("/{identity_id}/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_project(identity_id: str, project_id: str, db: Session = Depends(get_db)):
    if not graph.unlink_membership(db, identity_id, project_id):
        raise HTTPException(status_code=404, detail="Link not found")
    db.commit()


@router.get("/{identity_id}/projects")
def get_identity_projects(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    return [{"id": p.id, "name": p.name, "status": p.status} for p in graph.projects_for_identity(db, identity_id)]


# ── Share PIN management ─────────────────────────────────────────


class SetPinBody(BaseModel):
    pin: str


@router.post("/{identity_id}/set-pin")
def set_identity_pin(identity_id: str, body: SetPinBody, db: Session = Depends(get_db)):
    from app.services.pin_utils import hash_pin

    get_identity_or_404(identity_id, db)
    if not body.pin or len(body.pin) < 4 or len(body.pin) > 6 or not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")
    graph.update_identity(db, identity_id, share_pin_hash=hash_pin(body.pin))
    db.commit()
    return {"ok": True}


@router.delete("/{identity_id}/pin")
def clear_identity_pin(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    graph.update_identity(db, identity_id, share_pin_hash=None)
    db.commit()
    return {"ok": True}


# ── Share expiry management ────────���─────────────────────────────


class SetExpiryBody(BaseModel):
    expires_at: datetime | None


@router.post("/{identity_id}/set-expiry")
def set_identity_expiry(identity_id: str, body: SetExpiryBody, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    graph.update_identity(db, identity_id, share_expires_at=body.expires_at)
    db.commit()
    return {"ok": True}


# ── Share view count ─────────────────────────────────────────────


@router.get("/{identity_id}/share-views")
def get_share_view_count(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    count = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.action == "share.viewed",
            ActivityLog.meta.isnot(None),
            ActivityLog.meta["identity_id"].as_string() == identity_id,
        )
        .count()
    )
    return {"view_count": count}
