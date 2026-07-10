import hashlib
import hmac
import os
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import (
    ActivityLog,
    Comment,
    Cycle,
    CycleTask,
    Identity,
    Project,
    ProjectIdentity,
    Task,
    TaskLabel,
)
from app.services.activity import log_activity
from app.services.pin_utils import check_pin
from app.services.rate_limiter import share_rate_limit

router = APIRouter(prefix="/share", tags=["share"])

_PIN_SECRET = os.getenv("SECRET_KEY", "share-pin-default-secret")
_PIN_TTL = 900  # 15 minutes
_NOTE_DAILY_LIMIT = 20  # guest notes per visitor (ip hash) per UTC day


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
        if datetime.now(UTC).timestamp() - ts > _PIN_TTL:
            return False
        expected = hmac.new(_PIN_SECRET.encode(), f"{tid}:{ts_str}".encode(), hashlib.sha256).hexdigest()[:32]
        return hmac.compare_digest(sig, expected)
    except Exception:
        return False


def _hash_ip(ip: str) -> str:
    daily_salt = datetime.now(UTC).strftime("%Y-%m-%d")
    return hashlib.sha256(f"{daily_salt}:{ip}".encode()).hexdigest()[:16]


def _as_utc(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _load_identity(db: Session, token: str) -> Identity | None:
    """Load identity with all relationships eagerly to avoid N+1 queries."""
    return (
        db.query(Identity)
        .filter(Identity.share_token == token)
        .options(
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.tasks)
            .selectinload(Task.task_labels)
            .selectinload(TaskLabel.label),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.tasks)
            .selectinload(Task.subtasks),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.tasks)
            .selectinload(Task.comments),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.tasks)
            .selectinload(Task.blocked_by_deps),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.tasks)
            .selectinload(Task.blocking_deps),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.labels),
            selectinload(Identity.project_identities)
            .selectinload(ProjectIdentity.project)
            .selectinload(Project.cycles)
            .selectinload(Cycle.cycle_tasks)
            .selectinload(CycleTask.task),
        )
        .first()
    )


def _project_eager_options():
    return [
        selectinload(Project.tasks).selectinload(Task.task_labels).selectinload(TaskLabel.label),
        selectinload(Project.tasks).selectinload(Task.subtasks),
        selectinload(Project.tasks).selectinload(Task.comments),
        selectinload(Project.tasks).selectinload(Task.blocked_by_deps),
        selectinload(Project.tasks).selectinload(Task.blocking_deps),
        selectinload(Project.labels),
        selectinload(Project.cycles).selectinload(Cycle.cycle_tasks).selectinload(CycleTask.task),
        selectinload(Project.project_identities).selectinload(ProjectIdentity.identity),
    ]


def _load_project(db: Session, token: str) -> Project | None:
    return db.query(Project).filter(Project.share_token == token).options(*_project_eager_options()).first()


def _serialize_comment(c: Comment):
    return {
        "id": c.id,
        "author": c.author,
        "guest_name": c.guest_name,
        "is_guest": c.guest_name is not None,
        "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_project(p: Project, db: Session, include_notes: bool):
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
                "start_date": c.start_date.isoformat() if c.start_date else None,
                "end_date": c.end_date.isoformat() if c.end_date else None,
            }
            break

    comment_count = sum(len(t.comments) for t in tasks)

    task_map = {t.id: t.title for t in tasks}

    task_list = []
    for t in tasks:
        if t.parent_id is not None:
            continue
        t_labels = [{"name": tl.label.name, "color": tl.label.color} for tl in t.task_labels if tl.label]
        subtask_details = [
            {"id": s.id, "title": s.title, "status": s.status, "priority": s.priority} for s in t.subtasks
        ]
        blocked_by = [
            {"id": d.depends_on_id, "title": task_map.get(d.depends_on_id, "Unknown")} for d in t.blocked_by_deps
        ]
        blocking = [{"id": d.task_id, "title": task_map.get(d.task_id, "Unknown")} for d in t.blocking_deps]
        task_list.append(
            {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "status": t.status,
                "priority": t.priority,
                "assignee": t.assignee,
                "start_date": t.start_date.isoformat() if t.start_date else None,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "progress_pct": t.progress_pct,
                "time_estimate": t.time_estimate,
                "time_spent": t.time_spent,
                "labels": t_labels,
                "subtask_count": len(t.subtasks),
                "subtasks": subtask_details,
                "comment_count": len(t.comments),
                "comments": (
                    [_serialize_comment(c) for c in sorted(t.comments, key=lambda c: c.created_at)]
                    if include_notes
                    else []
                ),
                "blocked_by": blocked_by,
                "blocking": blocking,
            }
        )

    project_notes = []
    if include_notes:
        note_rows = (
            db.query(Comment)
            .filter(Comment.project_id == p.id, Comment.task_id.is_(None))
            .order_by(Comment.created_at.asc())
            .all()
        )
        project_notes = [_serialize_comment(c) for c in note_rows]

    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "status": p.status,
        "repo_url": p.repo_url,
        "total_tasks": total,
        "done_tasks": done,
        "progress": round(done / total * 100, 1) if total > 0 else 0.0,
        "labels": project_labels,
        "active_cycle": active_cycle,
        "comment_count": comment_count,
        "notes": project_notes,
        "tasks": task_list,
    }


def _build_payload(owner: dict, source_projects: list[Project], db: Session, scope: str, include_notes: bool = False):
    projects = []
    project_ids = []

    for p in source_projects:
        if not p or p.status != "active":
            continue
        project_ids.append(p.id)
        projects.append(_serialize_project(p, db, include_notes))

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
            recent_activity.append(
                {
                    "action": log.action,
                    "detail": log.detail,
                    "project_id": log.project_id,
                    "task_id": log.task_id,
                    "actor": log.actor,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
            )

    all_tasks_flat = []
    for p_data in projects:
        all_tasks_flat.extend(p_data["tasks"])
    total_tasks = sum(p["total_tasks"] for p in projects)
    done_tasks = sum(p["done_tasks"] for p in projects)
    now = datetime.now(UTC)
    overdue_tasks = sum(
        1 for t in all_tasks_flat if t["status"] != "done" and (due := _as_utc(t["due_date"])) and due < now
    )

    return {
        "identity": {
            **owner,
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
            "generated_at": datetime.now(UTC).isoformat(),
            "requires_pin": False,
            "scope": scope,
            "guest_notes_enabled": include_notes,
        },
    }


def _build_response(identity: Identity, db: Session):
    projects = [pi.project for pi in identity.project_identities]
    owner = {
        "id": identity.id,
        "name": identity.name,
        "color": identity.color,
        "avatar": identity.avatar,
        "description": identity.description,
    }
    return _build_payload(owner, projects, db, scope="identity", include_notes=identity.allow_guest_notes)


def _build_project_response(project: Project, db: Session):
    identity = project.project_identities[0].identity if project.project_identities else None
    owner = {
        "id": project.id,
        "name": project.name,
        "color": identity.color if identity else "#facc15",
        "avatar": project.name[:1].upper(),
        "description": project.description,
    }
    return _build_payload(owner, [project], db, scope="project", include_notes=project.allow_guest_notes)


def _maybe_log_view(db: Session, identity: Identity, ip_hash: str):
    """Log at most one view per IP-hash per hour to avoid bloating activity_logs."""
    try:
        one_hour_ago = datetime.now(UTC).replace(microsecond=0)
        one_hour_ago = one_hour_ago.replace(hour=one_hour_ago.hour, minute=0, second=0)
        existing = (
            db.query(ActivityLog.id)
            .filter(
                ActivityLog.action == "share.viewed",
                ActivityLog.actor == f"visitor:{ip_hash}",
                ActivityLog.meta.isnot(None),
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
    except Exception:
        db.rollback()


@router.get("/identity/{token}", dependencies=[Depends(share_rate_limit)])
def get_share_identity(token: str, request: Request, db: Session = Depends(get_db)):
    identity = _load_identity(db, token)
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if identity.share_expires_at:
        exp = _as_utc(identity.share_expires_at)
        if datetime.now(UTC) > exp:
            raise HTTPException(status_code=410, detail="Share link has expired")

    if identity.share_pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, identity.id):
            return {
                "meta": {"requires_pin": True, "generated_at": datetime.now(UTC).isoformat()},
                "identity": {"name": identity.name, "color": identity.color, "avatar": identity.avatar},
            }

    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    _maybe_log_view(db, identity, ip_hash)

    return _build_response(identity, db)


@router.get("/project/{token}", dependencies=[Depends(share_rate_limit)])
def get_share_project(token: str, request: Request, db: Session = Depends(get_db)):
    project = _load_project(db, token)
    if not project or project.status != "active":
        raise HTTPException(status_code=404, detail="Share link not found")

    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    _maybe_log_view(db, project.project_identities[0].identity, ip_hash) if project.project_identities else None

    return _build_project_response(project, db)


class PinVerifyRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/identity/{token}/verify", dependencies=[Depends(share_rate_limit)])
def verify_share_pin(token: str, body: PinVerifyRequest, response: Response, db: Session = Depends(get_db)):
    identity = _load_identity(db, token)
    if not identity:
        raise HTTPException(status_code=404, detail="Share link not found")

    if not identity.share_pin_hash:
        raise HTTPException(status_code=400, detail="No PIN set for this share link")

    if not check_pin(body.pin, identity.share_pin_hash):
        raise HTTPException(status_code=403, detail="Invalid PIN")

    ts = int(datetime.now(UTC).timestamp())
    session_token = _sign_token(identity.id, ts)
    response.set_cookie(
        key="share_session",
        value=session_token,
        max_age=_PIN_TTL,
        httponly=True,
        samesite="lax",
    )
    return _build_response(identity, db)


# ── Guest notes ──────────────────────────────────────────────────


class GuestNoteIn(BaseModel):
    guest_name: str = Field(..., min_length=1, max_length=80)
    body: str = Field(..., min_length=1, max_length=2000)
    project_id: str | None = None  # required for identity-scope project-level notes

    @field_validator("guest_name", "body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


def _resolve_note_target(scope: str, token: str, request: Request, db: Session) -> list[Project]:
    """Validate a guest-note write against a share token; return the projects it may write to."""
    if scope == "identity":
        identity = db.query(Identity).filter(Identity.share_token == token).first()
        if not identity:
            raise HTTPException(status_code=404, detail="Share link not found")
        if identity.share_expires_at and datetime.now(UTC) > _as_utc(identity.share_expires_at):
            raise HTTPException(status_code=410, detail="Share link has expired")
        if not identity.allow_guest_notes:
            raise HTTPException(status_code=403, detail="Guest notes are disabled for this share link")
        if identity.share_pin_hash:
            session_token = request.cookies.get("share_session")
            if not session_token or not _verify_token(session_token, identity.id):
                raise HTTPException(status_code=403, detail="PIN verification required")
        return [pi.project for pi in identity.project_identities if pi.project and pi.project.status == "active"]
    if scope == "project":
        project = db.query(Project).filter(Project.share_token == token).first()
        if not project or project.status != "active":
            raise HTTPException(status_code=404, detail="Share link not found")
        if not project.allow_guest_notes:
            raise HTTPException(status_code=403, detail="Guest notes are disabled for this share link")
        return [project]
    raise HTTPException(status_code=404, detail="Share link not found")


def _enforce_note_quota(db: Session, ip_hash: str):
    day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    count = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.action == "share.note",
            ActivityLog.actor == f"visitor:{ip_hash}",
            ActivityLog.created_at >= day_start,
        )
        .count()
    )
    if count >= _NOTE_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="Daily guest note limit reached")


def _create_note(db: Session, project_id: str, task_id: str | None, body: GuestNoteIn, request: Request) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    _enforce_note_quota(db, ip_hash)
    note = Comment(task_id=task_id, project_id=project_id, guest_name=body.guest_name, body=body.body)
    db.add(note)
    log_activity(
        db,
        "share.note",
        project_id=project_id,
        task_id=task_id,
        actor=f"visitor:{ip_hash}",
        detail=f"Guest note from {body.guest_name}",
    )
    db.commit()
    db.refresh(note)
    return _serialize_comment(note)


@router.post("/{scope}/{token}/notes", status_code=201, dependencies=[Depends(share_rate_limit)])
def create_guest_project_note(
    scope: str, token: str, body: GuestNoteIn, request: Request, db: Session = Depends(get_db)
):
    projects = _resolve_note_target(scope, token, request, db)
    if scope == "project":
        project = projects[0]
    else:
        project = next((p for p in projects if p.id == body.project_id), None)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found in this share")
    return _create_note(db, project.id, None, body, request)


@router.post("/{scope}/{token}/tasks/{task_id}/notes", status_code=201, dependencies=[Depends(share_rate_limit)])
def create_guest_task_note(
    scope: str, token: str, task_id: str, body: GuestNoteIn, request: Request, db: Session = Depends(get_db)
):
    projects = _resolve_note_target(scope, token, request, db)
    project_ids = [p.id for p in projects]
    task = db.query(Task).filter(Task.id == task_id, Task.project_id.in_(project_ids)).first() if project_ids else None
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this share")
    return _create_note(db, task.project_id, task.id, body, request)
