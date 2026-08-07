from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ActivityLog
from app.routers.deps import get_identity_or_404
from app.schemas import IdentityHubOut, IdentityOut
from app.services import graph

# Reads only. An identity is a ``shareable``/``subscribable`` node whose create/update/
# delete go through the single graph write surface ``/api/nodes`` (ADR-0041 B — the write
# core seeds the ``share_token`` for any shareable type); project links are ``member_of``
# edges via ``/api/nodes/{id}/edges``, and the share facade (rotate-token/PIN/expiry) uses
# the generic ``/api/nodes/{id}/share/*`` endpoints. This router keeps the enriched identity
# reads (list, hub stats, linked projects, share-view count) that ``IdentityOut`` callers need.
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
                for t in graph.subtree_task_views(db, p.id, top_level_only=True):
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


# ── Reads: linked projects ────────────────────────────────────────


@router.get("/{identity_id}/projects")
def get_identity_projects(identity_id: str, db: Session = Depends(get_db)):
    get_identity_or_404(identity_id, db)
    return [{"id": p.id, "name": p.name, "status": p.status} for p in graph.projects_for_identity(db, identity_id)]


# ── Reads: share-view count ───────────────────────────────────────


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
