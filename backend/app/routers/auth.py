import hashlib
import hmac
import os
import secrets
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

# Built-in shared-password auth (works standalone, no external dependency).
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")

# Forward-auth / trusted-proxy mode: when set, the app trusts this request header
# to carry an already-authenticated identity (e.g. "Cf-Access-Authenticated-User-Email"
# for Cloudflare Access, "X-Auth-Request-Email" for oauth2-proxy, "Remote-User" for
# Authelia/Authentik). ONLY safe when the origin is reachable exclusively through that
# proxy — see ADR-0030.
AUTH_PROXY_HEADER = os.environ.get("AUTH_PROXY_HEADER", "").strip()

# Session token lifetime in seconds (default 7 days).
AUTH_TOKEN_TTL = int(os.environ.get("AUTH_TOKEN_TTL", "604800"))

# Login brute-force throttle: after AUTH_MAX_ATTEMPTS failures from one client within
# AUTH_LOCKOUT_SECONDS, further attempts are rejected until the window rolls off.
AUTH_MAX_ATTEMPTS = int(os.environ.get("AUTH_MAX_ATTEMPTS", "5"))
AUTH_LOCKOUT_SECONDS = int(os.environ.get("AUTH_LOCKOUT_SECONDS", "300"))

# In-memory failure log keyed by client IP. Sufficient for a single-instance
# self-hosted deployment; resets on restart.
_failed_attempts: dict[str, list[float]] = {}


def auth_enabled() -> bool:
    """True if any authentication mechanism is configured."""
    return bool(AUTH_PASSWORD or AUTH_PROXY_HEADER)


def _sign(payload: str, key: str) -> str:
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue_token() -> str:
    """Mint a signed session token that expires after AUTH_TOKEN_TTL seconds."""
    nonce = secrets.token_hex(16)
    expiry = int(time.time()) + AUTH_TOKEN_TTL
    payload = f"{nonce}.{expiry}"
    return f"{payload}.{_sign(payload, AUTH_PASSWORD)}"


def verify_token(token: str) -> bool:
    """True if the token carries a valid, unexpired HMAC signature.

    Returns False when no password is configured — callers must gate on
    auth_enabled()/proxy identity first; a bare token is never a pass-through.
    """
    if not AUTH_PASSWORD:
        return False
    parts = token.split(".", 2)
    if len(parts) != 3:
        return False
    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(parts[2], _sign(payload, AUTH_PASSWORD)):
        return False
    try:
        expiry = int(parts[1])
    except ValueError:
        return False
    return expiry > int(time.time())


def proxy_identity(request: Request) -> str | None:
    """Identity asserted by a trusted upstream proxy, or None if not in proxy mode
    or the header is absent."""
    if not AUTH_PROXY_HEADER:
        return None
    value = request.headers.get(AUTH_PROXY_HEADER, "").strip()
    return value or None


def is_authenticated(request: Request, token: str) -> bool:
    """Central gate: a request passes if a trusted proxy asserts an identity, or a
    valid password token is presented."""
    if proxy_identity(request) is not None:
        return True
    return bool(AUTH_PASSWORD) and verify_token(token)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _throttle_ok(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _failed_attempts.get(ip, []) if now - t < AUTH_LOCKOUT_SECONDS]
    _failed_attempts[ip] = recent
    return len(recent) < AUTH_MAX_ATTEMPTS


def _record_failure(ip: str) -> None:
    _failed_attempts.setdefault(ip, []).append(time.time())


def _clear_failures(ip: str) -> None:
    _failed_attempts.pop(ip, None)


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest, request: Request):
    if not AUTH_PASSWORD:
        return {"token": "no-auth", "auth_required": False}

    ip = _client_ip(request)
    if not _throttle_ok(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again later.",
        )

    if not hmac.compare_digest(body.password, AUTH_PASSWORD):
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="Incorrect password")

    _clear_failures(ip)
    return {"token": issue_token(), "auth_required": True}


@router.post("/logout")
def logout(request: Request):
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    if not auth_enabled():
        return {"ok": True, "auth_required": False}

    identity = proxy_identity(request)
    if identity is not None:
        # A trusted proxy already authenticated the user; the SPA needs no login gate.
        return {"ok": True, "auth_required": False, "mode": "proxy", "user": identity}

    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"ok": True, "auth_required": True, "mode": "password"}
