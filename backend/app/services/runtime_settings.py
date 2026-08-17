"""Runtime-adjustable system settings.

Certain scheduler behaviors (daily summary hour, due-soon reminder window)
were previously fixed at process start via environment variables. Because this
is a single-user personal tool, these are really user preferences. We persist
overrides in the `user_preferences` table under a single key so they can be
changed from the UI without a restart. Environment variables remain the
defaults/fallbacks. See ADR-0011.
"""

import os

from sqlalchemy.orm import Session

from app.models import UserPreference
from app.services.errors import Unprocessable

SETTINGS_KEY = "system-settings"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _defaults() -> dict[str, int]:
    return {
        "summary_hour": _env_int("SUMMARY_HOUR", 8),
        "due_soon_window_hours": _env_int("DUE_SOON_WINDOW_HOURS", 24),
        "reminder_cooldown_hours": _env_int("REMINDER_COOLDOWN_HOURS", 23),
        "backup_enabled": _env_int("BACKUP_ENABLED", 1),
        "backup_hour": _env_int("BACKUP_HOUR", 3),
        "backup_keep": _env_int("BACKUP_KEEP", 7),
    }


# Allowed inclusive range for each field. Enforced, not clamped — see ``update_system_settings``.
FIELD_BOUNDS: dict[str, tuple[int, int]] = {
    "summary_hour": (0, 23),
    "due_soon_window_hours": (1, 336),  # up to 14 days
    "reminder_cooldown_hours": (1, 168),  # up to 7 days
    "backup_enabled": (0, 1),
    "backup_hour": (0, 23),
    "backup_keep": (1, 90),
}


def get_system_settings(db: Session) -> dict[str, int]:
    """Return effective settings: stored overrides merged over env/defaults."""
    defaults = _defaults()
    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    stored = pref.value if pref and isinstance(pref.value, dict) else {}
    result = {}
    for key, default in defaults.items():
        try:
            result[key] = int(stored.get(key, default))
        except (TypeError, ValueError):
            result[key] = default
    return result


def validate_updates(updates: dict) -> dict[str, int]:
    """The requested overrides as ints, or the refusal (ADR-0091).

    This used to clamp: ``backup_hour: 99`` was silently stored as 23 and answered ``200``
    with the clamped value. A person moving a number input never produces 99, so the clamp
    read as harmless defensiveness; an agent composing a settings payload from a plan is
    exactly the caller that does, and it would be told its change was applied. Out of range
    is a contradiction in the request, not a fact about the world — 422, like a rule whose
    conditions its trigger never supplies (ADR-0055).
    """
    validated: dict[str, int] = {}
    for key, value in updates.items():
        if value is None:
            continue
        if key not in FIELD_BOUNDS:
            raise Unprocessable(f"unknown setting '{key}'; known settings are {', '.join(sorted(FIELD_BOUNDS))}")
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise Unprocessable(f"'{key}' must be a whole number") from exc
        lo, hi = FIELD_BOUNDS[key]
        if not lo <= number <= hi:
            raise Unprocessable(f"'{key}' must be between {lo} and {hi}, got {number}")
        validated[key] = number
    return validated


def update_system_settings(db: Session, updates: dict) -> dict[str, int]:
    """Apply and persist overrides, refusing anything out of range."""
    current = get_system_settings(db)
    current.update(validate_updates(updates))

    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    if pref:
        pref.value = current
    else:
        pref = UserPreference(key=SETTINGS_KEY, value=current)
        db.add(pref)
    db.commit()
    return current
