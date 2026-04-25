import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Identity, ActivityLog, Cycle
from app.services.rate_limiter import share_rate_limit

router = APIRouter(prefix="/share", tags=["share"])

# Simple signed token for PIN sessions (no JWT dependency needed)
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


def _hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
    return f"{salt}:{h}"


def _check_pin(pin: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        return hmac.compare_digest(hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest(), h)
    except Exception:
        return False


def _hash_ip(ip: str) -> str:
    daily_salt = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return hashlib.sha256(f"{daily_salt}:{ip}".encode()).hexdigest()[:16]


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

        # Collect unique labels used in this project
        project_labels = []
        seen_labels = set()
        for lbl in p.labels:
            if lbl.id not in seen_labels:
                seen_labels.add(lbl.id)
                project_labels.append({"name": lbl.name, "color": lbl.color})

        # Active cycle
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

        # Comment count for the whole project
        comment_count = sum(len(t.comments) for t in tasks)

        # Build task list (top-level only)
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

    # Recent activity (last 15 entries for this identity's projects)
    recent_activity = []
    if project_ids:
        logs = (
            db.query(ActivityLog)
            .filter(ActivityLog.project_id.in_(project_ids))
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

    # Summary stats
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


@router.get("/identity/{token}", dependencies=[Depends(share_rate_limit)])
def get_share_identity(token: str, request: Request, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.share_token == token).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    # Check expiry
    if identity.share_expires_at:
        exp = identity.share_expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=410, detail="Share link has expired")

    # Check PIN
    if identity.share_pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, identity.id):
            return {
                "meta": {"requires_pin": True, "generated_at": datetime.now(timezone.utc).isoformat()},
                "identity": {"name": identity.name, "color": identity.color, "avatar": identity.avatar},
            }

    # Log view
    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    view_log = ActivityLog(
        action="share.viewed",
        actor=f"visitor:{ip_hash}",
        detail=f"Share page viewed for {identity.name}",
    )
    db.add(view_log)
    db.commit()

    return _build_response(identity, db)


class PinVerifyRequest(BaseModel):
    pin: str


@router.post("/identity/{token}/verify", dependencies=[Depends(share_rate_limit)])
def verify_share_pin(token: str, body: PinVerifyRequest, response: Response, db: Session = Depends(get_db)):
    identity = db.query(Identity).filter(Identity.share_token == token).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if not identity.share_pin_hash:
        raise HTTPException(status_code=400, detail="No PIN set for this share link")

    if not _check_pin(body.pin, identity.share_pin_hash):
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


# --- Helpers for identity management (PIN set/clear) ---

class SetPinRequest(BaseModel):
    pin: str  # 4-6 digit string


@router.post("/identity/{token}/set-pin")
def set_share_pin(token: str, body: SetPinRequest, db: Session = Depends(get_db)):
    """Set or update the PIN for a share link. Called from authenticated Identities page."""
    identity = db.query(Identity).filter(Identity.share_token == token).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if not body.pin or len(body.pin) < 4 or len(body.pin) > 6 or not body.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be 4-6 digits")

    identity.share_pin_hash = _hash_pin(body.pin)
    db.commit()
    return {"ok": True}


@router.delete("/identity/{token}/pin")
def clear_share_pin(token: str, db: Session = Depends(get_db)):
    """Remove the PIN from a share link."""
    identity = db.query(Identity).filter(Identity.share_token == token).first()
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")
    identity.share_pin_hash = None
    db.commit()
    return {"ok": True}
