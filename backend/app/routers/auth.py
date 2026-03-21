import hashlib
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")


def _make_token(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def verify_token(token: str) -> bool:
    """Returns True if token is valid (or auth is not configured)."""
    if not AUTH_PASSWORD:
        return True
    return token == _make_token(AUTH_PASSWORD)


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest):
    if not AUTH_PASSWORD:
        return {"token": "no-auth", "auth_required": False}
    if body.password != AUTH_PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect password")
    return {"token": _make_token(body.password), "auth_required": True}


@router.get("/me")
def me(request: Request):
    if not AUTH_PASSWORD:
        return {"ok": True, "auth_required": False}
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"ok": True, "auth_required": True}
