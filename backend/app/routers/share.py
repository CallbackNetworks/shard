import hashlib
import hmac
import json
import logging
import os
import secrets
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ActivityLog,
    Comment,
    ShareChatLog,
)
from app.services import graph
from app.services.activity import log_activity
from app.services.llm import get_provider
from app.services.pin_utils import check_pin
from app.services.rate_limiter import share_chat_rate_limit, share_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/share", tags=["share"])


def _resolve_pin_secret() -> str:
    """Secret used to sign share-PIN session cookies.

    Never fall back to a fixed constant: a public default would let anyone forge
    a PIN session and bypass a share PIN. When SECRET_KEY is unset we use a random
    per-process secret (PIN sessions then simply do not survive a restart) and
    warn, so a real deployment sets SECRET_KEY explicitly.
    """
    secret = os.getenv("SECRET_KEY", "")
    if secret:
        return secret
    logger.warning(
        "SECRET_KEY is not set; using an ephemeral per-process secret for share PIN sessions. "
        "Set SECRET_KEY in production so PIN sessions survive restarts and cannot be forged."
    )
    return secrets.token_hex(32)


_PIN_SECRET = _resolve_pin_secret()
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


def _load_identity(db: Session, token: str) -> graph.IdentityView | None:
    # An identity's projects are resolved via owns edges (see _build_response).
    return graph.find_identity_by_share_token(db, token)


def _load_project(db: Session, token: str) -> graph.ProjectView | None:
    # Tasks/labels/cycles are all node-only graph reads in _serialize_project
    # (ADR-0033); no ORM relationships to eager-load here.
    return graph.find_project_by_share_token(db, token)


def _serialize_comment(c: Comment):
    return {
        "id": c.id,
        "author": c.author,
        "guest_name": c.guest_name,
        "is_guest": c.guest_name is not None,
        "body": c.body,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_project(p: graph.ProjectView, db: Session, include_notes: bool):
    # Subtree scope (ADR-0065): what a share link calls "this project" is the same
    # set of work the app calls this project — tasks held by a nested container
    # included, or the shared page would show a smaller project than its owner sees.
    # The listing keeps every task (subtasks are rendered under their parent below);
    # the headline numbers come from the one size rule, top-level tasks only.
    task_ids = graph.subtree_task_ids(db, p.id)
    tasks = graph.task_views_for_ids(db, task_ids) if task_ids else []
    stats = graph.container_subtree_stats(db, p.id)
    total, done = stats.total_tasks, stats.done_tasks

    project_labels = []
    seen_labels = set()
    for lbl in graph.labels_in_project(db, p.id):
        if lbl.id not in seen_labels:
            seen_labels.add(lbl.id)
            project_labels.append({"name": lbl.name, "color": lbl.color})

    active_cycle = None
    for c in graph.cycles_in_project(db, p.id):
        if c.status == "active":
            c_tasks = graph.tasks_in_cycle(db, c.id)
            ct_total = len(c_tasks)
            ct_done = sum(1 for t in c_tasks if t.status == "done")
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
    tasks_by_id = {t.id: t for t in tasks}
    _ids = list(task_map.keys())
    blocked_by_map, blocking_map = graph.dependency_maps(db, _ids)
    labels_by_task = graph.labels_map(db, _ids)
    subtask_set = graph.subtask_ids_among(db, _ids)
    children_map = graph.child_task_ids_map(db, _ids)

    task_list = []
    for t in tasks:
        if t.id in subtask_set:
            continue
        t_labels = [{"name": lb.name, "color": lb.color} for lb in labels_by_task.get(t.id, [])]
        t_subtasks = [tasks_by_id[cid] for cid in children_map.get(t.id, []) if cid in tasks_by_id]
        subtask_details = [
            {"id": s.id, "title": s.title, "status": s.status, "priority": s.priority} for s in t_subtasks
        ]
        blocked_by = [{"id": bid, "title": task_map.get(bid, "Unknown")} for bid in blocked_by_map.get(t.id, [])]
        blocking = [{"id": bid, "title": task_map.get(bid, "Unknown")} for bid in blocking_map.get(t.id, [])]
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
                "subtask_count": len(t_subtasks),
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


def _build_payload(
    owner: dict, source_projects: list[graph.ProjectView], db: Session, scope: str, include_notes: bool = False
):
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


def _build_response(identity: graph.IdentityView, db: Session):
    projects = graph.projects_for_identity(db, identity.id)
    owner = {
        "id": identity.id,
        "name": identity.name,
        "color": identity.color,
        "avatar": identity.avatar,
        "description": identity.description,
    }
    return _build_payload(owner, projects, db, scope="identity", include_notes=identity.allow_guest_notes)


def _build_project_response(project: graph.ProjectView, db: Session):
    idents = graph.identities_for_project(db, project.id)
    identity = idents[0] if idents else None
    owner = {
        "id": project.id,
        "name": project.name,
        "color": identity.color if identity else "#facc15",
        "avatar": project.name[:1].upper(),
        "description": project.description,
    }
    return _build_payload(owner, [project], db, scope="project", include_notes=project.allow_guest_notes)


def _maybe_log_share_view(db: Session, *, meta_key: str, entity_id: str, detail: str, ip_hash: str) -> None:
    """Log at most one view per IP-hash per hour to avoid bloating activity_logs.

    One implementation for all three facades. ``meta_key`` records which one served
    the page (``identity_id`` / ``project_id`` / ``node_id``);
    ``services.activity.share_view_count`` counts all three, so a node viewed through
    more than one facade still reports a single total.
    """
    try:
        hour_start = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        existing = (
            db.query(ActivityLog.id)
            .filter(
                ActivityLog.action == "share.viewed",
                ActivityLog.actor == f"visitor:{ip_hash}",
                ActivityLog.meta.isnot(None),
                ActivityLog.meta[meta_key].as_string() == entity_id,
                ActivityLog.created_at >= hour_start,
            )
            .first()
        )
        if not existing:
            db.add(
                ActivityLog(
                    action="share.viewed",
                    actor=f"visitor:{ip_hash}",
                    detail=detail,
                    meta={meta_key: entity_id},
                )
            )
            db.commit()
    except Exception:
        db.rollback()


# Not a route (ADR-0071): an identity is served through the one public door,
# /share/node/{token}, which dispatches here. Kept as a function because the
# owns aggregation an identity page needs is genuinely its own.
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
    _maybe_log_share_view(
        db,
        meta_key="identity_id",
        entity_id=identity.id,
        detail=f"Share page viewed for {identity.name}",
        ip_hash=ip_hash,
    )

    return _build_response(identity, db)


# Not a route (ADR-0073), like get_share_identity above: a project is served through
# the one public door, /share/node/{token}, which dispatches here. The dedicated
# serialization stays — a project page is genuinely its own shape.
def get_share_project(token: str, request: Request, db: Session = Depends(get_db)):
    project = _load_project(db, token)
    if not project or project.status != "active":
        raise HTTPException(status_code=404, detail="Share link not found")

    if project.share_expires_at and datetime.now(UTC) > _as_utc(project.share_expires_at):
        raise HTTPException(status_code=410, detail="Share link has expired")

    # A PIN set on a project is enforced here like it is on every other shareable
    # node (ADR-0072). It was settable through /api/nodes/{id}/share/set-pin all
    # along and this page served straight past it.
    if project.share_pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, project.id):
            return {
                "meta": {"requires_pin": True, "generated_at": datetime.now(UTC).isoformat()},
                "identity": {"name": project.name, "color": "#facc15", "avatar": None},
            }

    client_ip = request.client.host if request.client else "unknown"
    ip_hash = _hash_ip(client_ip)
    _maybe_log_share_view(
        db,
        meta_key="project_id",
        entity_id=project.id,
        detail=f"Project share page viewed for {project.name}",
        ip_hash=ip_hash,
    )

    return _build_project_response(project, db)


def _build_container_response(node, view: graph.ProjectView, db: Session):
    """Share payload for any shareable container node (ADR-0039).

    Mirrors ``_build_project_response`` but for a generic container: the node's
    own contained task-like children are serialized as a single project-like
    group. Identity keeps its aggregate (owns) behaviour via delegation.
    """
    idents = graph.identities_for_project(db, node.id)
    identity = idents[0] if idents else None
    owner = {
        "id": node.id,
        "name": view.name,
        "color": identity.color if identity else "#facc15",
        "avatar": (view.name[:1].upper() if view.name else "?"),
        "description": view.description,
    }
    return _build_payload(owner, [view], db, scope="node", include_notes=view.allow_guest_notes)


@router.get("/node/{token}", dependencies=[Depends(share_rate_limit)])
def get_share_node(token: str, request: Request, db: Session = Depends(get_db)):
    """Generic share facade for any ``is_shareable`` node (ADR-0039).

    Dispatches: identity and project delegate to their existing handlers so
    their behaviour is byte-for-byte unchanged; every other shareable container
    type is served through the generic container path.
    """
    node = graph.find_node_by_share_token(db, token)
    if not node:
        raise HTTPException(status_code=404, detail="Share link not found")
    if node.type == graph.NODE_IDENTITY:
        return get_share_identity(token, request, db)
    if node.type == graph.NODE_PROJECT:
        return get_share_project(token, request, db)

    data = node.data or {}
    expires = data.get("share_expires_at")
    if expires and datetime.now(UTC) > _as_utc(expires):
        raise HTTPException(status_code=410, detail="Share link has expired")

    pin_hash = data.get("share_pin_hash")
    if pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, node.id):
            return {
                "meta": {"requires_pin": True, "generated_at": datetime.now(UTC).isoformat()},
                "identity": {"name": node.title, "color": data.get("color", "#facc15"), "avatar": None},
            }

    view = graph.container_view(db, node.id)
    if not view or view.status != "active":
        raise HTTPException(status_code=404, detail="Share link not found")

    # A view count nobody records is a zero that looks like a fact: the generic
    # facade logs its views like the other two, so /nodes/{id}/share-views can
    # answer for a user-defined shareable type as well.
    _maybe_log_share_view(
        db,
        meta_key="node_id",
        entity_id=node.id,
        detail=f"Share page viewed for {node.title}",
        ip_hash=_hash_ip(request.client.host if request.client else "unknown"),
    )

    return _build_container_response(node, view, db)


class PinVerifyRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d{4,6}$")


@router.post("/node/{token}/verify", dependencies=[Depends(share_rate_limit)])
def verify_share_node_pin(token: str, body: PinVerifyRequest, response: Response, db: Session = Depends(get_db)):
    """Verify a PIN for a generic shareable node and mint a session cookie (ADR-0039)."""
    node = graph.find_node_by_share_token(db, token)
    if not node:
        raise HTTPException(status_code=404, detail="Share link not found")
    pin_hash = (node.data or {}).get("share_pin_hash")
    if not pin_hash:
        raise HTTPException(status_code=400, detail="No PIN set for this share link")
    if not check_pin(body.pin, pin_hash):
        raise HTTPException(status_code=403, detail="Invalid PIN")

    ts = int(datetime.now(UTC).timestamp())
    response.set_cookie(
        key="share_session",
        value=_sign_token(node.id, ts),
        max_age=_PIN_TTL,
        httponly=True,
        samesite="lax",
    )

    # Dispatch like the GET does: unlocking a page must hand back that page. Built
    # as container-only, this returned an identity's *empty* container view — the
    # projects it aggregates through owns are not `contains` children.
    if node.type == graph.NODE_IDENTITY:
        identity = graph.get_identity(db, node.id)
        if not identity:
            raise HTTPException(status_code=404, detail="Share link not found")
        return _build_response(identity, db)
    if node.type == graph.NODE_PROJECT:
        project = graph.get_project(db, node.id)
        if not project or project.status != "active":
            raise HTTPException(status_code=404, detail="Share link not found")
        return _build_project_response(project, db)

    view = graph.container_view(db, node.id)
    if not view or view.status != "active":
        raise HTTPException(status_code=404, detail="Share link not found")
    return _build_container_response(node, view, db)


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


def _check_note_access(
    *,
    entity_id: str,
    expires_at,
    allow_guest_notes: bool,
    pin_hash: str | None,
    request: Request,
) -> None:
    """The three gates a guest note passes, whichever share it was written on."""
    if expires_at and datetime.now(UTC) > _as_utc(expires_at):
        raise HTTPException(status_code=410, detail="Share link has expired")
    if not allow_guest_notes:
        raise HTTPException(status_code=403, detail="Guest notes are disabled for this share link")
    if pin_hash:
        session_token = request.cookies.get("share_session")
        if not session_token or not _verify_token(session_token, entity_id):
            raise HTTPException(status_code=403, detail="PIN verification required")


def _project_note_target(project: graph.ProjectView, request: Request) -> list[graph.ProjectView]:
    _check_note_access(
        entity_id=project.id,
        expires_at=project.share_expires_at,
        allow_guest_notes=project.allow_guest_notes,
        pin_hash=project.share_pin_hash,
        request=request,
    )
    return [project]


def _resolve_note_target(token: str, request: Request, db: Session) -> list[graph.ProjectView]:
    """Validate a guest-note write against a share token; return the projects it may write to.

    Dispatches on the node's type exactly as ``GET /share/node/{token}`` does — an
    identity aggregates its ``owns`` projects, anything else stands for itself.
    A page that can be read must be writable through the same door (ADR-0070); there
    is only one door left to be read through (ADR-0071, ADR-0073).
    """
    node = graph.find_node_by_share_token(db, token)
    if not node:
        raise HTTPException(status_code=404, detail="Share link not found")

    if node.type == graph.NODE_PROJECT:
        project = graph.get_project(db, node.id)
        if not project or project.status != "active":
            raise HTTPException(status_code=404, detail="Share link not found")
        return _project_note_target(project, request)

    if node.type == graph.NODE_IDENTITY:
        identity = graph.get_identity(db, node.id)
        if not identity:
            raise HTTPException(status_code=404, detail="Share link not found")
        _check_note_access(
            entity_id=identity.id,
            expires_at=identity.share_expires_at,
            allow_guest_notes=identity.allow_guest_notes,
            pin_hash=identity.share_pin_hash,
            request=request,
        )
        return [p for p in graph.projects_for_identity(db, identity.id) if p.status == "active"]

    view = graph.container_view(db, node.id)
    if not view or view.status != "active":
        raise HTTPException(status_code=404, detail="Share link not found")
    data = node.data or {}
    _check_note_access(
        entity_id=node.id,
        expires_at=data.get("share_expires_at"),
        allow_guest_notes=view.allow_guest_notes,
        pin_hash=data.get("share_pin_hash"),
        request=request,
    )
    return [view]


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


@router.post("/node/{token}/notes", status_code=201, dependencies=[Depends(share_rate_limit)])
def create_guest_project_note(token: str, body: GuestNoteIn, request: Request, db: Session = Depends(get_db)):
    projects = _resolve_note_target(token, request, db)
    # A share holding exactly one project (a project's own page, a container) needs no
    # ``project_id`` to disambiguate; an identity aggregates several, so there it says
    # which one. Was a per-scope branch until the scopes collapsed to one (ADR-0073).
    if body.project_id:
        project = next((p for p in projects if p.id == body.project_id), None)
    else:
        project = projects[0] if len(projects) == 1 else None
    if not project:
        raise HTTPException(status_code=404, detail="Project not found in this share")
    return _create_note(db, project.id, None, body, request)


@router.post("/node/{token}/tasks/{task_id}/notes", status_code=201, dependencies=[Depends(share_rate_limit)])
def create_guest_task_note(
    token: str, task_id: str, body: GuestNoteIn, request: Request, db: Session = Depends(get_db)
):
    projects = _resolve_note_target(token, request, db)
    project_ids = [p.id for p in projects]
    task_ids = {tid for pid in project_ids for tid in graph.contained_task_ids(db, pid)}
    task = graph.get_task(db, task_id) if task_id in task_ids else None
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this share")
    # Attribute the note to a project inside the share scope — a cross-project
    # task's nearest project may be one the guest was never granted (ADR-0032).
    # A share whose subject is a non-project container has no project of its own
    # in scope, so the note falls back to the task's own membership rather than
    # failing: the guest was granted the task, and project_id is bookkeeping.
    member_ids = graph.member_project_ids(db, task.id)
    in_scope = [pid for pid in project_ids if pid in set(member_ids)]
    note_project_id = in_scope[0] if in_scope else (member_ids[0] if member_ids else None)
    return _create_note(db, note_project_id, task.id, body, request)


# ── Public Q&A assistant (ADR-0098) ─────────────────────────────────


CHAT_SYSTEM_PROMPT = """You are answering questions from an anonymous visitor to a public,
read-only share page for a personal task-tracking tool. You may only use the JSON data given
to you below — it is exactly what this share link already displays. You have no other tools,
cannot take any action (nothing you say changes anything), and know nothing about any other
project, task, or person beyond what is in this JSON. If asked about anything outside it,
say you don't have that information. Be concise. Respond in the same language the visitor uses.

SHARE DATA:
"""


class ShareChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class ShareChatRequest(BaseModel):
    messages: list[ShareChatMessage] = Field(..., min_length=1, max_length=20)


def _log_share_chat(
    db: Session,
    *,
    node_id: str,
    question: str,
    answer: str,
    ip_hash: str,
    usage: dict | None = None,
) -> None:
    try:
        db.add(
            ShareChatLog(
                node_id=node_id,
                question=question,
                answer=answer,
                ip_hash=ip_hash,
                input_tokens=usage["input_tokens"] if usage else None,
                output_tokens=usage["output_tokens"] if usage else None,
            )
        )
        db.commit()
    except Exception:
        db.rollback()


@router.post("/node/{token}/chat", dependencies=[Depends(share_rate_limit), Depends(share_chat_rate_limit)])
async def share_chat(token: str, body: ShareChatRequest, request: Request, db: Session = Depends(get_db)):
    """Answer a visitor's question using nothing but the same data ``GET /share/node/{token}``
    already returns them (ADR-0098). No tools, no dispatch: the payload this call injects
    into the system prompt *is* ``get_share_node``'s own return value, so there is exactly
    one place — this function call — where "what can the assistant know" is decided, and it
    is the same answer as "what does the page already show."

    Reachable directly by API, not only through the page's widget, same as every other
    ``/share/*`` endpoint (token [+ PIN] is the credential, not the calling client)."""
    payload = get_share_node(token, request, db)
    if payload.get("meta", {}).get("requires_pin"):
        raise HTTPException(status_code=403, detail="PIN verification required")
    node_id = payload["identity"]["id"]

    system = CHAT_SYSTEM_PROMPT + json.dumps(payload)
    messages = [m.model_dump() for m in body.messages]
    provider = get_provider(db)
    question = body.messages[-1].content
    ip_hash = _hash_ip(request.client.host if request.client else "unknown")

    async def event_stream():
        answer_text = []
        usage = None
        try:
            async for event in provider.chat(messages, [], system):
                if event["type"] == "error":
                    yield f"data: {json.dumps({'type': 'error', 'message': event['message']})}\n\n"
                elif event["type"] == "text":
                    answer_text.append(event["text"])
                    yield f"data: {json.dumps({'type': 'text', 'text': event['text']})}\n\n"
                elif event["type"] == "usage":
                    usage = event
                elif event["type"] == "done":
                    if answer_text:
                        _log_share_chat(
                            db,
                            node_id=node_id,
                            question=question,
                            answer="".join(answer_text),
                            ip_hash=ip_hash,
                            usage=usage,
                        )
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return
        except Exception as exc:
            logger.error("Share chat streaming error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
