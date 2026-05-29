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


async def share_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not _share_limiter.check(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
