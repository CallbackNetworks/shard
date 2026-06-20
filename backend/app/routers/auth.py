import hashlib
import hmac
import os
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")


def _sign(payload: str, key: str) -> str:
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str) -> bool:
    """Returns True if token carries a valid HMAC signature (or auth is not configured)."""
    if not AUTH_PASSWORD:
        return True
    parts = token.split(".", 2)
    if len(parts) != 3:
        return False
    payload = f"{parts[0]}.{parts[1]}"
    return hmac.compare_digest(parts[2], _sign(payload, AUTH_PASSWORD))


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest):
    if not AUTH_PASSWORD:
        return {"token": "no-auth", "auth_required": False}
    if body.password != AUTH_PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect password")
    nonce = secrets.token_hex(16)
    ts = secrets.token_hex(4)
    payload = f"{nonce}.{ts}"
    token = f"{payload}.{_sign(payload, AUTH_PASSWORD)}"
    return {"token": token, "auth_required": True}


@router.post("/logout")
def logout(request: Request):
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
