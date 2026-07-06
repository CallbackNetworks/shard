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


# Allowed inclusive range for each field, used to clamp user input.
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


def update_system_settings(db: Session, updates: dict) -> dict[str, int]:
    """Apply and persist overrides. Unknown keys are ignored; values are clamped."""
    current = get_system_settings(db)
    for key, value in updates.items():
        if key in FIELD_BOUNDS and value is not None:
            lo, hi = FIELD_BOUNDS[key]
            try:
                current[key] = max(lo, min(hi, int(value)))
            except (TypeError, ValueError):
                continue

    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    if pref:
        pref.value = current
    else:
        pref = UserPreference(key=SETTINGS_KEY, value=current)
        db.add(pref)
    db.commit()
    return current
