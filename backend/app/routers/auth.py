import os
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")

# In-memory session store — tokens are lost on restart (re-login required).
_active_tokens: set[str] = set()


def verify_token(token: str) -> bool:
    """Returns True if token is valid (or auth is not configured)."""
    if not AUTH_PASSWORD:
        return True
    return token in _active_tokens


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest):
    if not AUTH_PASSWORD:
        return {"token": "no-auth", "auth_required": False}
    if body.password != AUTH_PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect password")
    token = secrets.token_hex(32)
    _active_tokens.add(token)
    return {"token": token, "auth_required": True}


@router.post("/logout")
def logout(request: Request):
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    _active_tokens.discard(token)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    if not AUTH_PASSWORD:
        return {"ok": True, "auth_required": False}
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"ok": True, "auth_required": True}
