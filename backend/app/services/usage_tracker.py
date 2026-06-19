"""
In-memory route-level usage tracking.

Tracks request counts, error rates, and average response times per
method+path combination. Data resets on server restart — this is
intentional for a personal tool (no extra DB tables needed).
"""

import time
from collections import defaultdict
from dataclasses import dataclass

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


@dataclass
class RouteStats:
    hits: int = 0
    errors: int = 0
    total_ms: float = 0.0
    last_access: float = 0.0

    @property
    def avg_ms(self) -> float:
        return round(self.total_ms / self.hits, 1) if self.hits else 0.0

    def to_dict(self) -> dict:
        return {
            "hits": self.hits,
            "errors": self.errors,
            "avg_ms": self.avg_ms,
            "last_access": self.last_access,
        }


class UsageTracker:
    """Singleton accumulator for per-route request stats."""

    def __init__(self):
        self._routes: dict[str, RouteStats] = defaultdict(RouteStats)

    def record(self, method: str, path: str, status: int, duration_ms: float):
        key = f"{method} {path}"
        entry = self._routes[key]
        entry.hits += 1
        entry.total_ms += duration_ms
        entry.last_access = time.time()
        if status >= 400:
            entry.errors += 1

    def snapshot(self) -> list[dict]:
        """Return all routes sorted by hit count descending."""
        rows = []
        for key, stats in self._routes.items():
            method, path = key.split(" ", 1)
            rows.append({"method": method, "path": path, **stats.to_dict()})
        rows.sort(key=lambda r: r["hits"], reverse=True)
        return rows

    def reset(self):
        self._routes.clear()


# Module-level singleton
tracker = UsageTracker()

_SKIP_PREFIXES = ("/health", "/docs", "/openapi.json", "/redoc", "/ws")


class UsageTrackingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Skip noisy endpoints
        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        # Normalize path parameters to reduce cardinality
        normalized = _normalize_path(path)
        tracker.record(request.method, normalized, response.status_code, duration_ms)

        return response


def _normalize_path(path: str) -> str:
    """Replace UUID-like and numeric segments with placeholders."""
    parts = path.strip("/").split("/")
    out = []
    for part in parts:
        if _is_uuid(part):
            out.append(":id")
        elif part.isdigit():
            out.append(":n")
        else:
            out.append(part)
    return "/" + "/".join(out)


def _is_uuid(s: str) -> bool:
    """Check if string looks like a UUID (8-4-4-4-12 hex)."""
    if len(s) == 36 and s.count("-") == 4:
        return all(c in "0123456789abcdef-" for c in s.lower())
    return False
