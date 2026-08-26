"""The planning analytics, for both doors (ADR-0086).

``/api/v1`` had overview, heatmap, velocity and status-trend — the retrospective half. The
half that answers *what should I do next* (critical path, burn-down, calibrated estimates)
was internal-only, which is the half an agent planning work actually needs.

Moved here rather than re-derived on the v1 side: `routers/external_api/analytics.py`
already carries its own copy of velocity, and a second copy of anything here would be a
second answer to a question that has one.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Node
from app.services import graph
from app.services.critical_path import compute_critical_path
from app.services.datetimes import ensure_aware

# Estimate size buckets, in minutes: (label, low, high-inclusive or None for open-ended).
ESTIMATE_BUCKETS = [
    ("<=30m", 0, 30),
    ("31-60m", 31, 60),
    ("1-2h", 61, 120),
    ("2-4h", 121, 240),
    (">4h", 241, None),
]

# Minimum completed samples before a calibration suggestion is offered at all, and the
# minimum in a specific size bucket before we trust that bucket's ratio over the overall
# median.
MIN_CALIBRATION_SAMPLE = 5
MIN_BUCKET_SAMPLE = 3


def critical_path(db: Session, project_id: str):
    """The longest dependency chain through a project — what actually gates the end date."""
    return compute_critical_path(db, project_id)


def burndown(db: Session, cycle_id: str) -> list[dict]:
    cycle = graph.get_cycle(db, cycle_id)
    if not cycle:
        return []

    start = ensure_aware(cycle.start_date) or ensure_aware(cycle.created_at)
    end = ensure_aware(cycle.end_date) or datetime.now(UTC)
    if not start:
        return []

    task_ids = graph.task_ids_in_cycle(db, cycle_id)
    if not task_ids:
        return []

    total = len(task_ids)
    result = []
    current = start
    while current <= end:
        day_end = current.replace(hour=23, minute=59, second=59)
        done_count = (
            db.query(func.count(Node.id))
            .filter(
                graph.task_type_filter(db),
                Node.id.in_(task_ids),
                Node.status == "done",
                Node.updated_at <= day_end,
            )
            .scalar()
            or 0
        )
        result.append({"date": current.strftime("%Y-%m-%d"), "remaining": total - done_count, "done": done_count})
        current += timedelta(days=1)
        if len(result) > 365:
            break

    return result


def cycle_burndown(db: Session, cycle_id: str) -> list[dict]:
    """Daily remaining tasks for a cycle, with the ideal line alongside."""
    cycle = graph.get_cycle(db, cycle_id)
    if not cycle:
        return []

    cycle_task_ids = graph.task_ids_in_cycle(db, cycle.id)
    if not cycle_task_ids:
        return []

    tasks = db.query(Node).filter(graph.task_type_filter(db), Node.id.in_(cycle_task_ids)).all()
    total = len(tasks)

    # SQLite hands these back naive for the same column PostgreSQL makes aware, and both
    # are compared against `now` below — so a cycle *with* an end date raised TypeError
    # and a cycle without one worked. See services/datetimes.
    start = ensure_aware(cycle.start_date) or min(
        (ensure_aware(t.created_at) for t in tasks), default=datetime.now(UTC)
    )
    end = ensure_aware(cycle.end_date) or datetime.now(UTC)

    result = []
    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = end.replace(hour=23, minute=59, second=59)
    today = datetime.now(UTC)
    if end_day > today:
        end_day = today

    while current <= end_day:
        day_end = current.replace(hour=23, minute=59, second=59)
        done_by_day = sum(
            1 for t in tasks if t.status == "done" and t.updated_at and ensure_aware(t.updated_at) <= day_end
        )
        result.append(
            {
                "date": current.strftime("%Y-%m-%d"),
                "remaining": total - done_by_day,
                "total": total,
                "done": done_by_day,
            }
        )
        current += timedelta(days=1)

    if len(result) > 1:
        for i, point in enumerate(result):
            point["ideal"] = round(total - (total * i / (len(result) - 1)), 1)

    return result


def _completed_estimated(db: Session, project_id: str | None, cap: int) -> list:
    """Done tasks that carry both an estimate and a spend, newest first.

    ``time_estimate``/``time_spent`` live in ``node.data`` (JSON), so they are filtered in
    Python after the hot-column query for dialect-safety (ADR-0033).
    """
    q = db.query(Node).filter(graph.task_type_filter(db), Node.status == "done")
    if project_id:
        q = q.filter(Node.id.in_(graph.contained_task_ids(db, project_id)))
    return [
        v
        for v in (graph.task_view(n, db) for n in q.order_by(Node.updated_at.desc()).all())
        if v.time_estimate and v.time_estimate > 0 and v.time_spent and v.time_spent > 0
    ][:cap]


def _median(values: list[float]) -> float:
    n = len(values)
    return values[n // 2] if n % 2 == 1 else (values[n // 2 - 1] + values[n // 2]) / 2


def estimation_calibration(db: Session, project_id: str | None = None, limit: int = 500) -> dict:
    """Compare ``time_estimate`` against ``time_spent`` on completed tasks.

    Returns overall calibration (spent/estimate ratio) plus accuracy grouped by estimate
    size, so systematic under/over-estimation becomes visible.
    """
    tasks = _completed_estimated(db, project_id, limit)

    if not tasks:
        return {
            "sample_size": 0,
            "overall_ratio": None,
            "median_ratio": None,
            "within_20_pct": None,
            "underestimated": 0,
            "overestimated": 0,
            "buckets": [],
            "recent_tasks": [],
        }

    ratios = sorted(t.time_spent / t.time_estimate for t in tasks)
    n = len(ratios)
    total_estimate = sum(t.time_estimate for t in tasks)
    total_spent = sum(t.time_spent for t in tasks)
    within = sum(1 for r in ratios if 0.8 <= r <= 1.2)

    buckets = []
    for label, low, high in ESTIMATE_BUCKETS:
        bucket_tasks = [t for t in tasks if t.time_estimate >= low and (high is None or t.time_estimate <= high)]
        if not bucket_tasks:
            buckets.append({"label": label, "count": 0, "avg_ratio": None})
            continue
        bucket_ratio = sum(t.time_spent for t in bucket_tasks) / sum(t.time_estimate for t in bucket_tasks)
        buckets.append({"label": label, "count": len(bucket_tasks), "avg_ratio": round(bucket_ratio, 2)})

    recent_projects = graph.project_ids_map(db, [t.id for t in tasks[:20]])
    recent = [
        {
            "id": t.id,
            "title": t.title,
            "project_id": next(iter(recent_projects.get(t.id, [])), None),
            "time_estimate": t.time_estimate,
            "time_spent": t.time_spent,
            "ratio": round(t.time_spent / t.time_estimate, 2),
        }
        for t in tasks[:20]
    ]

    return {
        "sample_size": n,
        "overall_ratio": round(total_spent / total_estimate, 2),
        "median_ratio": round(_median(ratios), 2),
        "within_20_pct": round(within / n * 100),
        "underestimated": sum(1 for r in ratios if r > 1.2),
        "overestimated": sum(1 for r in ratios if r < 0.8),
        "buckets": buckets,
        "recent_tasks": recent,
    }


def estimate_suggestion(db: Session, raw_estimate: int, project_id: str | None = None) -> dict:
    """Calibrate a raw estimate against the user's own history (closes the loop).

    Applies the historical spent/estimate ratio for tasks of a similar size, or the overall
    median when that size bucket is sparse. Falls back to global history when a project has
    too few completed, estimated tasks. Returns ``suggested_estimate: None`` with a reason
    when there is not enough signal — a number invented from three samples is worse than
    no number.
    """
    tasks = _completed_estimated(db, project_id, 2000)
    basis_scope = "project"
    if project_id and len(tasks) < MIN_CALIBRATION_SAMPLE:
        tasks = _completed_estimated(db, None, 2000)
        basis_scope = "global"

    if len(tasks) < MIN_CALIBRATION_SAMPLE:
        return {
            "raw_estimate": raw_estimate,
            "suggested_estimate": None,
            "reason": "not_enough_history",
            "sample_size": len(tasks),
        }

    # Prefer the ratio of the size bucket the raw estimate falls into.
    bucket_label = None
    bucket_tasks = []
    for label, low, high in ESTIMATE_BUCKETS:
        if raw_estimate >= low and (high is None or raw_estimate <= high):
            bucket_label = label
            bucket_tasks = [t for t in tasks if t.time_estimate >= low and (high is None or t.time_estimate <= high)]
            break

    if len(bucket_tasks) >= MIN_BUCKET_SAMPLE:
        ratio = sum(t.time_spent for t in bucket_tasks) / sum(t.time_estimate for t in bucket_tasks)
        basis = "bucket"
        sample = len(bucket_tasks)
    else:
        ratios = sorted(t.time_spent / t.time_estimate for t in tasks)
        ratio = _median(ratios)
        basis = "overall_median"
        sample = len(ratios)

    return {
        "raw_estimate": raw_estimate,
        "suggested_estimate": max(1, round(raw_estimate * ratio)),
        "ratio": round(ratio, 2),
        "basis": basis,
        "basis_scope": basis_scope,
        "bucket": bucket_label,
        "sample_size": sample,
    }
