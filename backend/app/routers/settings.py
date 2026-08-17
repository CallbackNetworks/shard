from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UserPreference
from app.routers import auth as auth_mod
from app.services import settings_admin
from app.services.settings_admin import LLMSettingsUpdate, SystemSettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

DASHBOARD_WIDGETS = [
    {"id": "stat-cards", "label": "Stats Overview", "default": True},
    {"id": "command-hero", "label": "Command Center", "default": True},
    {"id": "priority-wall", "label": "Priority Lanes", "default": True},
    {"id": "agent-tasks", "label": "Agent Tasks", "default": True},
    {"id": "due-soon", "label": "Due Soon", "default": True},
    {"id": "ops-sidebar", "label": "Live Signals & Briefing", "default": True},
    {"id": "projects-grid", "label": "Projects Grid", "default": True},
]


@router.get("")
def get_settings(request: Request, db: Session = Depends(get_db)):
    """Return current system settings (non-sensitive)."""
    return settings_admin.read(db)


@router.get("/bounds")
def get_settings_bounds():
    """The legal range of every writable setting."""
    return settings_admin.bounds()


@router.put("/system")
def put_system_settings(body: SystemSettingsUpdate, db: Session = Depends(get_db)):
    """Update runtime-adjustable scheduler settings (persisted, no restart needed)."""
    return settings_admin.update(db, body.model_dump(exclude_none=True))


@router.put("/llm")
def put_llm_settings(body: LLMSettingsUpdate, db: Session = Depends(get_db)):
    """Update the assistant's provider/model/API key (persisted, no restart needed)."""
    return settings_admin.update_llm(db, body.model_dump(exclude_none=True))


@router.get("/ical-token")
def get_ical_token(db: Session = Depends(get_db)):
    """Return the global iCal token for the personal 'all projects' feed."""
    return settings_admin.ical_token(db)


@router.post("/ical-token/rotate")
def rotate_ical_token(db: Session = Depends(get_db)):
    """Issue a new global iCal token, invalidating the previous subscribe URL."""
    return settings_admin.rotate_ical_token(db)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(body: PasswordChangeRequest, request: Request):
    """Change the auth password at runtime (non-persistent across restarts)."""
    if not auth_mod.AUTH_PASSWORD:
        raise HTTPException(status_code=400, detail="Authentication is not enabled")

    if body.current_password != auth_mod.AUTH_PASSWORD:
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")

    auth_mod.AUTH_PASSWORD = body.new_password
    # Old HMAC-signed tokens are automatically invalid since they were signed with the old password.
    return {"ok": True, "message": "Password changed. All sessions invalidated."}


@router.get("/dashboard-widgets")
def get_dashboard_widgets():
    """Return the list of available dashboard widgets."""
    return DASHBOARD_WIDGETS


@router.get("/preferences/{key}")
def get_preference(key: str, db: Session = Depends(get_db)):
    pref = db.query(UserPreference).filter(UserPreference.key == key).first()
    if not pref:
        return {"key": key, "value": None}
    return {"key": pref.key, "value": pref.value}


class PreferenceUpdate(BaseModel):
    value: dict | list


@router.put("/preferences/{key}")
def set_preference(key: str, body: PreferenceUpdate, db: Session = Depends(get_db)):
    pref = db.query(UserPreference).filter(UserPreference.key == key).first()
    if pref:
        pref.value = body.value
    else:
        pref = UserPreference(key=key, value=body.value)
        db.add(pref)
    db.commit()
    return {"key": key, "value": pref.value}
