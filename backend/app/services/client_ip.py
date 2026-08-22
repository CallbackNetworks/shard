"""Where a request came from — resolved once, for every caller that keys on it.

Two callers throttle by client address and they disagreed, each wrong in the
direction the other was right (ADR-0109):

- ``routers/auth.py`` trusted ``X-Forwarded-For`` unconditionally and took the
  *leftmost* entry. That entry is whatever the client typed, so a new value per
  request gave every attempt its own bucket and the login lockout never fired.
- ``services/rate_limiter.py`` read ``request.client.host`` only. Behind any
  reverse proxy that is the proxy, so every visitor shared one bucket and the
  share limiter became a global lockout for all of them at once.

The header cannot be trusted or distrusted as a whole — trust depends on how many
proxies are actually in front of this process, which is deployment knowledge the
code cannot infer. ``TRUSTED_PROXY_HOPS`` supplies it, and defaults to 0: with no
declaration we trust nothing and use the socket peer, so a direct-to-internet
deployment is safe by default rather than by configuration.

Each proxy appends the address it received from, so the rightmost ``hops`` entries
were written by infrastructure the operator controls and everything to the left of
them is client-supplied. Counting in from the right therefore steps over anything
forged: a client who sends a fake chain only pushes their own real address further
right, it does not change which index is ours.
"""

import os

from fastapi import Request

UNKNOWN = "unknown"


def trusted_proxy_hops() -> int:
    """How many reverse proxies sit in front of this process. 0 = trust no header."""
    try:
        return max(0, int(os.getenv("TRUSTED_PROXY_HOPS", "0")))
    except ValueError:
        # A malformed value must not silently become "trust everything".
        return 0


def client_ip(request: Request) -> str:
    """The caller's address, honouring X-Forwarded-For only as far as it is trusted."""
    socket_ip = request.client.host if request.client else UNKNOWN

    hops = trusted_proxy_hops()
    if hops == 0:
        return socket_ip

    chain = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    index = len(chain) - hops
    if index < 0:
        # Fewer entries than declared hops: the header is missing, stripped, or the
        # count is wrong. Falling back to the socket peer collapses everyone behind
        # the proxy into one bucket, which is a throttle that is too strict — the
        # safe way to be wrong. Believing a short chain would be too lax.
        return socket_ip
    return chain[index]
