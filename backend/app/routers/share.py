import hashlib
import hmac
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Identity, ActivityLog, ProjectIdentity
from app.services.rate_limiter import share_rate_limit
from app.services.pin_utils import hash_pin, check_pin

router = APIRouter(prefix="/share", tags=["share"])

_PIN_SECRET = os.getenv("SECRET_KEY", "share-pin-default-secret")
_PIN_TTL = 900  # 15 minutes


def _sign_token(identity_id: str, ts: int) -> str:
    payload = f"{identity_id}:{ts}"
    sig = hmac.new(_PIN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}:{sig}"


def _verify_token(token: str, identity_id: str) -> bool:
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return False
        tid, ts_str, sig = parts
        if tid != identity_id:
            return False
        ts = int(ts_str)
        if datetime.now(timezone.utc).timestamp() - ts > _PIN_TTL:
            return False
        expected = hmac.new(_PIN_SECRET.encode(), f"{tid}:{ts_str}".encode(), hashlib.sha256).hexdigest()[:32]
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _hash_ip(ip: str) -> str:
    daily_salt = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return hashlib.sha256(f"{daily_salt}:{ip}".encode()).hexdigest()[:16]


def _load_identity(db: Session, token: str) -> Identity | None:
    """Load identity with all relationships eagerly to avoid N+1 queries."""
    return (
        db.query(Identity)
        .filter(Identity.share_token == token)
        .options(
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload("tasks")
            .selectinload("task_labels")
            .selectinload("label"),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload("tasks")
            .selectinload("subtasks"),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload("tasks")
            .selectinload("comments"),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload("labels"),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload("cycles")
            .selectinload("cycle_tasks")
            .selectinload("task"),
        )
        .first()
    )


def _build_response(identity: Identity, db: Session):
    project_ids = []
    projects = []

    for pi in identity.project_identities:
        p = pi.project
        if not p or p.status != "active":
            continue
        project_ids.append(p.id)
        tasks = p.tasks
        total = len(tasks)
        done = sum(1 for t in tasks if t.status == "done")

        project_labels = []
        seen_labels = set()
        for lbl in p.labels:
            if lbl.id not in seen_labels:
                seen_labels.add(lbl.id)
                project_labels.append({"name": lbl.name, "color": lbl.color})

        active_cycle = None
        for c in p.cycles:
            if c.status == "active":
                ct_total = len(c.cycle_tasks)
                ct_done = sum(1 for ct in c.cycle_tasks if ct.task and ct.task.status == "done")
                active_cycle = {
                    "name": c.name,
                    "total_tasks": ct_total,
                    "done_tasks": ct_done,
                    "progress": round(ct_done / ct_total * 100, 1) if ct_total > 0 else 0.0,
                }
                break

        comment_count = sum(len(t.comments) for t in tasks)

        task_list = []
        for t in tasks:
            if t.parent_id is not None:
                continue
            t_labels = [
                {"name": tl.label.name, "color": tl.label.color}
                for tl in t.task_labels
                if tl.label
            ]
            task_list.append({
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "assignee": t.assignee,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "labels": t_labels,
                "subtask_count": len(t.subtasks),
                "comment_count": len(t.comments),
            })

        projects.append({
            "id": p.id,
            "name": p.name,
            "status": p.status,
            "total_tasks": total,
            "done_tasks": done,
            "progress": round(done / total * 100, 1) if total > 0 else 0.0,
            "labels": project_labels,
            "active_cycle": active_cycle,
            "comment_count": comment_count,
            "tasks": task_list,
        })

    recent_activity = []
    if project_ids:
        logs = (
            db.query(ActivityLog)
            .filter(
                ActivityLog.project_id.in_(project_ids),
                ActivityLog.action != "share.viewed",
            )
            .order_by(ActivityLog.created_at.desc())
            .limit(15)
            .all()
        )
        for log in logs:
            recent_activity.append({
                "action": log.action,
                "detail": log.detail,
                "project_id": log.project_id,
                "task_id": log.task_id,
                "actor": log.actor,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            })

    all_tasks_flat = []
    for p_data in projects:
        all_tasks_flat.extend(p_data["tasks"])
    total_tasks = sum(p["total_tasks"] for p in projects)
    done_tasks = sum(p["done_tasks"] for p in projects)
    overdue_tasks = sum(
        1 for t in all_tasks_flat
        if t["due_date"] and t["status"] != "done"
        and datetime.fromisoformat(t["due_date"]) < datetime.now(timezone.utc)
    )

    return {
        "identity": {
            "id": identity.id,
            "name": identity.name,
            "color": identity.color,
            "avatar": identity.avatar,
            "description": identity.description,
        },
        "projects": projects,
        "recent_activity": recent_activity,
        "summary": {
            "total_projects": len(projects),
            "total_tasks": total_tasks,
            "done_tasks": done_tasks,
            "overdue_tasks": overdue_tasks,
            "overall_progress": round(done_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0.0,
        },
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "requires_pin": False,
        },
    }


def _maybe_log_view(db: Session, identity: Identity, ip_hash: str):
    """Log at most one view per IP-hash per hour to avoid bloating activity_logs."""
    from sqlalchemy import func
    one_hour_ago = datetime.now(timezone.utc).replace(microsecond=0)
    one_hour_ago = one_hour_ago.replace(
        hour=one_hour_ago.hour, minute=0, second=0
    )
    existing = (
        db.query(ActivityLog.id)
        .filter(
            ActivityLog.action == "share.viewed",
            ActivityLog.actor == f"visitor:{ip_hash}",
            ActivityLog.meta["identity_id"].as_string() == identity.id,
            ActivityLog.created_at >= one_hour_ago,
        )
        .first()
    )
    if not existing:
        view_log = ActivityLog(
            action="share.viewed",
            actor=f"visitor:{ip_hash}",
            detail=f"Share page viewed for {identity.name}",
            meta={"identity_id": identity.id},
        )
        db.add(view_log)
        db.commit()


@router.get("/identity/{token}", dependencies=[Depends(share_rate_limit)])
def get_share_identity(token: str, request: Request, db: Session = Depends(get_db)):
    identity = _load_identity(db, token)
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if identity.share_expires_at:
        exp = identity.share_expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=410, detail="Share link has expired")

    if identity.share_pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, identity.id):
            return {
                "meta": {"requires_pin": True, "generated_at": datetime.now(timezone.utc).isoformat()},
                "identity": {"name": identity.name, "color": identity.color, "avatar": identity.avatar},
            }

    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    _maybe_log_view(db, identity, ip_hash)

    return _build_response(identity, db)


class PinVerifyRequest(BaseModel):
    pin: str


@router.post("/identity/{token}/verify", dependencies=[Depends(share_rate_limit)])
def verify_share_pin(token: str, body: PinVerifyRequest, response: Response, db: Session = Depends(get_db)):
    identity = _load_identity(db, token)
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if not identity.share_pin_hash:
        raise HTTPException(status_code=400, detail="No PIN set for this share link")

    if not check_pin(body.pin, identity.share_pin_hash):
        raise HTTPException(status_code=403, detail="Invalid PIN")

    ts = int(datetime.now(timezone.utc).timestamp())
    session_token = _sign_token(identity.id, ts)
    response.set_cookie(
        key="share_session",
        value=session_token,
        max_age=_PIN_TTL,
        httponly=True,
        samesite="lax",
    )
    return _build_response(identity, db)
