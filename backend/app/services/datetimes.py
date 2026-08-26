"""Normalising a DB-loaded datetime, in one place.

SQLite hands back a naive datetime for the same ``DateTime(timezone=True)`` column that
PostgreSQL hands back aware. Any Python-side comparison against ``datetime.now(UTC)``
therefore raises ``TypeError: can't compare offset-naive and offset-aware datetimes`` on
SQLite and passes on PostgreSQL — a failure that the dual-database test matrix
(ADR-0018/0020) exists to catch, and that only shows up on the rows where the nullable
column is actually set.

That is not hypothetical. ``analytics_admin.cycle_burndown`` compared a cycle's
``end_date`` against now, so every cycle with an end date — which is to say every normal
sprint — returned a 500 from ``GET /api/v1/analytics/cycle-burndown``, while a cycle
without one worked fine.

``scheduler`` and ``issue_sync`` had each already written this function privately. A
third copy appearing at the moment a bug was found in a module that had neither is the
argument for it living here.
"""

from datetime import UTC, datetime


def ensure_aware(dt: datetime | None) -> datetime | None:
    """A DB-loaded datetime as aware UTC. ``None`` passes through."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
