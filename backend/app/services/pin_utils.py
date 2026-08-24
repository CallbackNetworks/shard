"""Shared PIN hashing utilities used by share and identities routers.

A share PIN is short and numeric — the keyspace is 10^4 for the four digits the UI
asks for. That is what makes the *hash* choice matter: a single round of salted
SHA-256, which this used to be, sweeps that whole keyspace in about ten
milliseconds, so anyone holding a copy of the database holds every PIN in it.

PBKDF2-SHA256 does not make a four-digit PIN strong; nothing can. It changes the
cost of a sweep from "instant" to "roughly half an hour per PIN per core", which is
the difference between a database leak being an immediate compromise and being
something with time to respond to. Online guessing is bounded by the share rate
limiter instead (ADR-0109), not by this.

``ITERATIONS`` is a deliberate compromise rather than the OWASP headline figure.
``/share/node/{token}/verify`` is unauthenticated and production runs a single
uvicorn worker (ADR-0101), so each verification's cost is also a cost an anonymous
caller can impose. Measured in the backend image: 100k ≈ 87ms, 200k ≈ 180ms,
600k ≈ 618ms. At the limiter's 60 requests/minute, 600k would let one address burn
37 s of CPU per minute — enough to starve the worker. 200k holds that near 11 s
while still costing an offline attacker five orders of magnitude more than before.

The cost is stored *in* the hash, so raising it later is a one-line change that
leaves existing hashes verifiable.
"""

import hashlib
import hmac
import secrets

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 200_000
SALT_BYTES = 16


def hash_pin(pin: str) -> str:
    """``pbkdf2_sha256$<iterations>$<salt>$<hex digest>``."""
    salt = secrets.token_hex(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), ITERATIONS).hex()
    return f"{ALGORITHM}${ITERATIONS}${salt}${digest}"


def check_pin(pin: str, stored: str) -> bool:
    """Verify against either hash format.

    The legacy ``<salt>:<sha256>`` form is still accepted because share PINs already
    exist in deployed databases and this function has no way to write a replacement:
    refusing them would silently lock owners out of their own live share links, which
    is a worse failure than the weak hash it was trying to correct. Those rows upgrade
    when the PIN is next set.
    """
    try:
        if stored.startswith(f"{ALGORITHM}$"):
            _, iterations, salt, digest = stored.split("$", 3)
            computed = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), int(iterations)).hex()
            return hmac.compare_digest(computed, digest)

        # Legacy: one round of salted SHA-256.
        salt, digest = stored.split(":", 1)
        return hmac.compare_digest(hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest(), digest)
    except Exception:
        return False


def needs_rehash(stored: str) -> bool:
    """True if ``stored`` is not at the current algorithm and cost.

    Lets a caller that *can* write — the share admin service, on a successful
    verification — upgrade a hash in place instead of waiting for the owner to
    happen to set a new PIN.
    """
    if not stored.startswith(f"{ALGORITHM}$"):
        return True
    try:
        return int(stored.split("$", 2)[1]) < ITERATIONS
    except (IndexError, ValueError):
        return True
