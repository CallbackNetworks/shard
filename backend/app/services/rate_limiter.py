"""Simple in-memory sliding window rate limiter for share endpoints."""

import time
from collections import defaultdict

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._cleanup_counter = 0

    def check(self, key: str) -> bool:
        now = time.time()
        cutoff = now - self.window
        hits = self._hits[key]
        # Remove expired entries
        self._hits[key] = [t for t in hits if t > cutoff]
        if len(self._hits[key]) >= self.max_requests:
            return False
        self._hits[key].append(now)
        # Periodic cleanup of old keys
        self._cleanup_counter += 1
        if self._cleanup_counter >= 100:
            self._cleanup_counter = 0
            self._cleanup(now)
        return True

    def _cleanup(self, now: float):
        cutoff = now - self.window
        dead_keys = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for k in dead_keys:
            del self._hits[k]


_share_limiter = RateLimiter(max_requests=60, window_seconds=60)
_api_limiter = RateLimiter(max_requests=120, window_seconds=60)
_share_chat_limiter = RateLimiter(max_requests=20, window_seconds=3600)


async def share_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not _share_limiter.check(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")


def share_chat_rate_limit(token: str) -> None:
    """20 questions per share token per hour.

    Keyed by the token itself, not the caller's IP: the token is the scarce, gate-kept
    resource an LLM call costs money against, and it must hold no matter which client
    is asking (page widget or a direct API call — both are legitimate, ADR-0098).
    Same trust level as ``share_rate_limit``: in-memory, per-process, so it is not
    shared across the multiple uvicorn workers a production deploy runs and resets on
    restart — a stopgap, not a hard cap.
    """
    if not _share_chat_limiter.check(token):
        raise HTTPException(status_code=429, detail="Too many questions for this share link. Try again later.")


async def api_rate_limit(request: Request):
    """Rate limit for External API v1 — keyed by API key value."""
    api_key = request.headers.get("x-api-key", "")
    if not api_key:
        return
    if not _api_limiter.check(api_key):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Max 120 requests per minute.",
            headers={"Retry-After": "60"},
        )
