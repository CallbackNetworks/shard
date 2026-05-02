"""Shared PIN hashing utilities used by share and identities routers."""

import hashlib
import hmac
import secrets


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
    return f"{salt}:{h}"


def check_pin(pin: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        return hmac.compare_digest(hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest(), h)
    except Exception:
        return False
