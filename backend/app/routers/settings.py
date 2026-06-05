import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.routers.auth import AUTH_PASSWORD, _active_tokens

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("")
def get_settings(request: Request):
    """Return current system settings (non-sensitive)."""
    return {
        "auth_enabled": bool(AUTH_PASSWORD),
        "llm_provider": os.getenv("LLM_PROVIDER", "stub"),
        "llm_model": os.getenv("LLM_MODEL", ""),
        "smtp_configured": bool(os.getenv("SMTP_HOST")),
        "summary_hour": int(os.getenv("SUMMARY_HOUR", "8")),
        "mcp_transport": os.getenv("MCP_TRANSPORT", "stdio"),
    }


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
def change_password(body: PasswordChangeRequest, request: Request):
    """Change the auth password at runtime (non-persistent across restarts)."""
    import app.routers.auth as auth_mod

    if not auth_mod.AUTH_PASSWORD:
        raise HTTPException(status_code=400, detail="Authentication is not enabled")

    if body.current_password != auth_mod.AUTH_PASSWORD:
        raise HTTPException(status_code=403, detail="Current password is incorrect")

    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")

    auth_mod.AUTH_PASSWORD = body.new_password
    # Invalidate all existing sessions
    _active_tokens.clear()
    return {"ok": True, "message": "Password changed. All sessions invalidated."}
