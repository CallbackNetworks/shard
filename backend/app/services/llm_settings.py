"""Runtime-adjustable LLM provider configuration (ADR-0096).

``LLM_PROVIDER``/``LLM_API_KEY``/``LLM_MODEL`` were process-start-only environment
variables: changing the assistant's provider meant editing a deploy secret and
redeploying. They now follow the ADR-0091 precedent — an override persisted in
``user_preferences``, env vars as the fallback default, effective on the next request
with no restart — and the ADR-0063 credential rule for the key: reading never yields
it, and leaving a field out of a write means "unchanged" so a client that reads a
redacted response back and saves it cannot blank the key it was never shown.

``provider``/``model``/``api_key`` all resolve DB-override-or-env the same way (a plain
``or``), which is also how ``""`` clears an override back to the environment default —
one rule for all three fields rather than a separate "unset" sentinel for the credential.
"""

import os

from sqlalchemy.orm import Session

from app.models import UserPreference
from app.services.errors import Unprocessable

SETTINGS_KEY = "llm-settings"
PROVIDERS = ("claude", "openai", "stub")


def _stored(db: Session) -> dict:
    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    return dict(pref.value) if pref and isinstance(pref.value, dict) else {}


def get_effective_llm_config(db: Session) -> dict:
    """Provider/model/api_key actually in effect, for building a provider client.

    The one place the real key is returned — ``services/llm.get_provider`` — never a
    caller across an API boundary.
    """
    stored = _stored(db)
    return {
        "provider": stored.get("provider") or os.getenv("LLM_PROVIDER", "stub"),
        "model": stored.get("model") or os.getenv("LLM_MODEL", ""),
        "api_key": stored.get("api_key") or os.getenv("LLM_API_KEY", ""),
    }


def read(db: Session) -> dict:
    """Effective provider/model plus whether a key is configured — never the key."""
    config = get_effective_llm_config(db)
    return {
        "llm_provider": config["provider"],
        "llm_model": config["model"],
        "llm_api_key_configured": bool(config["api_key"]),
    }


def update(db: Session, updates: dict) -> dict:
    """Persist a partial override.

    A key left out of ``updates`` (``None`` after ``exclude_none``) is unchanged.
    ``""`` is a deliberate clear back to the environment default, for any of the three
    fields alike. ``provider``, if non-empty, must be one of ``PROVIDERS``.
    """
    provider = updates.get("provider")
    if provider is not None and provider != "" and provider not in PROVIDERS:
        raise Unprocessable(f"'provider' must be one of {', '.join(PROVIDERS)}")

    stored = _stored(db)
    for key in ("provider", "model", "api_key"):
        if key in updates and updates[key] is not None:
            stored[key] = updates[key]

    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    if pref:
        pref.value = stored
    else:
        pref = UserPreference(key=SETTINGS_KEY, value=stored)
        db.add(pref)
    db.commit()
    return read(db)
