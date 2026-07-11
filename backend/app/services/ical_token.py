"""Global iCal token for the personal 'all projects' calendar feed.

This is a single-user tool, so the aggregate feed is gated by one app-level
secret rather than a per-project token. The token is persisted in the
`user_preferences` table so it survives restarts and can be rotated from the UI
without changing any other credential. See ADR-0023.
"""

import hmac
import uuid

from sqlalchemy.orm import Session

from app.models import UserPreference

_PREF_KEY = "ical-global-token"


def get_global_ical_token(db: Session) -> str:
    """Return the global iCal token, generating and persisting one on first use."""
    pref = db.query(UserPreference).filter(UserPreference.key == _PREF_KEY).first()
    if pref and isinstance(pref.value, dict) and pref.value.get("token"):
        return pref.value["token"]

    token = str(uuid.uuid4())
    if pref is None:
        db.add(UserPreference(key=_PREF_KEY, value={"token": token}))
    else:
        pref.value = {"token": token}
    db.commit()
    return token


def rotate_global_ical_token(db: Session) -> str:
    """Issue a new global iCal token, invalidating the previous subscribe URL."""
    token = str(uuid.uuid4())
    pref = db.query(UserPreference).filter(UserPreference.key == _PREF_KEY).first()
    if pref is None:
        db.add(UserPreference(key=_PREF_KEY, value={"token": token}))
    else:
        pref.value = {"token": token}
    db.commit()
    return token


def verify_global_ical_token(db: Session, token: str) -> bool:
    """Constant-time comparison against the stored global token."""
    if not token:
        return False
    return hmac.compare_digest(token, get_global_ical_token(db))
