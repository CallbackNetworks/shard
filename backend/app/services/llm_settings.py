"""Runtime-adjustable LLM provider configuration (ADR-0096, ADR-0097).

``LLM_PROVIDER``/``LLM_API_KEY``/``LLM_MODEL`` were process-start-only environment
variables: changing the assistant's provider meant editing a deploy secret and
redeploying. They now follow the ADR-0091 precedent — an override persisted in
``user_preferences``, env vars as the fallback default, effective on the next request
with no restart — and the ADR-0063 credential rule for the key: reading never yields
it, and leaving a field out of a write means "unchanged" so a client that reads a
redacted response back and saves it cannot blank the key it was never shown.

``provider``/``model``/``api_key``/``base_url`` all resolve DB-override-or-env the same
way (a plain ``or``), which is also how ``""`` clears an override back to the
environment default — one rule for every field rather than a separate "unset"
sentinel for the credential.

``provider`` names a wire protocol (which SDK shape to speak), not a vendor:
``base_url`` is what points it at a specific endpoint. Any service that speaks the
OpenAI chat-completions protocol — Cloudflare AI Gateway, a self-hosted
OpenAI-compatible gateway, an internal proxy — is `provider="openai"` plus its own
`base_url`; a real third protocol would still need its own client class, but a new
*vendor* on an existing protocol needs none.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import AssistantMessage, ShareChatLog, UserPreference
from app.services.errors import Unprocessable

USAGE_WINDOW_DAYS = 30

SETTINGS_KEY = "llm-settings"
PROVIDERS = ("claude", "openai", "stub")
_OVERRIDE_FIELDS = ("provider", "model", "api_key", "base_url")


def _stored(db: Session) -> dict:
    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    return dict(pref.value) if pref and isinstance(pref.value, dict) else {}


def get_effective_llm_config(db: Session) -> dict:
    """Provider/model/api_key/base_url actually in effect, for building a provider client.

    The one place the real key is returned — ``services/llm.get_provider`` — never a
    caller across an API boundary.
    """
    stored = _stored(db)
    return {
        "provider": stored.get("provider") or os.getenv("LLM_PROVIDER", "stub"),
        "model": stored.get("model") or os.getenv("LLM_MODEL", ""),
        "api_key": stored.get("api_key") or os.getenv("LLM_API_KEY", ""),
        "base_url": stored.get("base_url") or os.getenv("LLM_BASE_URL", ""),
    }


def usage_summary(db: Session, days: int = USAGE_WINDOW_DAYS) -> dict:
    """Token counts, not cost (ADR-0100): no pricing table exists anywhere in this app,
    and per-model $/token rates drift — a number this app made up would go stale
    silently. Sums both the owner's own conversations (``AssistantMessage``) and the
    public share assistant's exchanges (``ShareChatLog``), since both spend against the
    same configured provider. A row with no usage recorded (``StubProvider``, or one
    written before this column existed) contributes 0, not an error.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)
    assistant_in, assistant_out = (
        db.query(
            func.coalesce(func.sum(AssistantMessage.input_tokens), 0),
            func.coalesce(func.sum(AssistantMessage.output_tokens), 0),
        )
        .filter(AssistantMessage.created_at >= cutoff)
        .first()
    )
    share_in, share_out = (
        db.query(
            func.coalesce(func.sum(ShareChatLog.input_tokens), 0),
            func.coalesce(func.sum(ShareChatLog.output_tokens), 0),
        )
        .filter(ShareChatLog.created_at >= cutoff)
        .first()
    )
    return {
        "llm_usage_window_days": days,
        "llm_usage_input_tokens": int(assistant_in) + int(share_in),
        "llm_usage_output_tokens": int(assistant_out) + int(share_out),
    }


def read(db: Session) -> dict:
    """Effective provider/model/base_url plus whether a key is configured — never the key.

    ``base_url`` is a destination, not a secret — the ADR-0063 rule that applies to
    ``api_key`` does not apply to it.
    """
    config = get_effective_llm_config(db)
    return {
        "llm_provider": config["provider"],
        "llm_model": config["model"],
        "llm_base_url": config["base_url"],
        "llm_api_key_configured": bool(config["api_key"]),
        **usage_summary(db),
    }


def _verify_model(provider: str, model: str, api_key: str, base_url: str) -> dict:
    """Best-effort check that ``model`` is a real name on this provider's own catalog.

    Never raises and never blocks the save: a gateway that does not implement
    ``/models``, a transient network failure, or the SDK package simply not being
    installed (ADR-0096: ``anthropic``/``openai`` are opt-in, not in requirements.txt
    by default) are all facts about the world, not a contradiction in the request —
    the ADR-0055 distinction between a 422 and a warning applies here too. ``checked``
    is False whenever no verdict could be reached at all; ``ok`` is only meaningful
    when ``checked`` is True.
    """
    if not model or not api_key or provider not in ("claude", "openai"):
        return {"checked": False, "ok": None, "detail": None}
    try:
        ids: set[str] = set()
        if provider == "claude":
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, base_url=base_url or None)
            for m in client.models.list():
                ids.add(m.id)
                if len(ids) >= 500:
                    break
        else:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=base_url or None)
            ids = {m.id for m in client.models.list()}
    except Exception as exc:  # noqa: BLE001 - genuinely any failure here degrades to "unverified"
        return {"checked": False, "ok": None, "detail": f"could not verify against the provider: {exc}"}

    if model in ids:
        return {"checked": True, "ok": True, "detail": None}
    return {"checked": True, "ok": False, "detail": f"'{model}' was not in this provider's model list"}


def update(db: Session, updates: dict) -> dict:
    """Persist a partial override.

    A key left out of ``updates`` (``None`` after ``exclude_none``) is unchanged.
    ``""`` is a deliberate clear back to the environment default, for any field alike.
    ``provider``, if non-empty, must be one of ``PROVIDERS``. When ``model`` is part of
    this write, the response carries a best-effort ``model_check`` — never persisted,
    informational only for this one response.
    """
    provider = updates.get("provider")
    if provider is not None and provider != "" and provider not in PROVIDERS:
        raise Unprocessable(f"'provider' must be one of {', '.join(PROVIDERS)}")

    stored = _stored(db)
    for key in _OVERRIDE_FIELDS:
        if key in updates and updates[key] is not None:
            stored[key] = updates[key]

    pref = db.query(UserPreference).filter(UserPreference.key == SETTINGS_KEY).first()
    if pref:
        pref.value = stored
    else:
        pref = UserPreference(key=SETTINGS_KEY, value=stored)
        db.add(pref)
    db.commit()

    result = read(db)
    if "model" in updates:
        effective = get_effective_llm_config(db)
        result["model_check"] = _verify_model(
            effective["provider"], effective["model"], effective["api_key"], effective["base_url"]
        )
    return result
