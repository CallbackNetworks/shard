"""How this instance is configured, for every door that configures it (ADR-0091).

The scheduler's timings — when the daily summary goes out, how far ahead "due soon" looks,
when the backup runs and how many it keeps — are stored settings, not environment variables,
precisely so they can be changed without a restart (ADR-0011). But the only thing that could
change them was the Settings page, which in production sits behind ``AUTH_PASSWORD``: the
one class of capability ADR-0085 set out to eliminate. An agent could create the work, plan
it, automate it and be notified about it, and could not move the notification an hour later.

The read half is here too, because ``GET /settings`` is not a database read: it reports
``auth_mode``, the LLM provider and whether SMTP is configured, all assembled from process
state. Assembled in the router it would have been assembled twice, and the two doors would
answer "is email configured" differently the first time one of them was edited.

The iCal token lives here rather than with the node share tokens because it is not a node's:
it is one app-level secret for the aggregate "all projects" feed (ADR-0023). Rotating it is
``admin``, on the ADR-0087 rule — the token *is* the subscribe URL, so handing it out hands
out the feed, and issuing a new one breaks every calendar client already subscribed.
"""

import os

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.routers import auth as auth_mod
from app.services import llm_settings
from app.services.ical_token import get_global_ical_token, rotate_global_ical_token
from app.services.runtime_settings import FIELD_BOUNDS, get_system_settings, update_system_settings


class SystemSettingsUpdate(BaseModel):
    """A partial write of the scheduler's timings. ``extra="forbid"`` on purpose: a
    misspelled key used to be dropped in silence, which for a settings write is the same
    failure as the clamp — a 200 for a change that did not happen."""

    model_config = ConfigDict(extra="forbid")

    summary_hour: int | None = None
    due_soon_window_hours: int | None = None
    reminder_cooldown_hours: int | None = None
    backup_enabled: int | None = None
    backup_hour: int | None = None
    backup_keep: int | None = None


class LLMSettingsUpdate(BaseModel):
    """A partial write of the assistant's provider config (ADR-0096).

    ``extra="forbid"`` for the same reason as ``SystemSettingsUpdate``. A field left out
    is unchanged; ``""`` clears that field's override back to its environment default.
    """

    model_config = ConfigDict(extra="forbid")

    provider: str | None = None
    model: str | None = None
    api_key: str | None = None


def auth_mode() -> str:
    if auth_mod.AUTH_PROXY_HEADER:
        return "proxy"
    if auth_mod.AUTH_PASSWORD:
        return "password"
    return "none"


def read(db: Session) -> dict:
    """Effective settings plus the non-sensitive facts about how this process is wired.

    Nothing here is a credential: ``smtp_configured`` is a boolean about a password, not the
    password, and ``llm_model`` is the name of a model, not the key that reaches it.
    """
    return {
        "auth_enabled": auth_mod.auth_enabled(),
        "auth_mode": auth_mode(),
        "smtp_configured": bool(os.getenv("SMTP_HOST")),
        "mcp_transport": os.getenv("MCP_TRANSPORT", "stdio"),
        **llm_settings.read(db),
        **get_system_settings(db),
    }


def bounds() -> dict[str, dict[str, int]]:
    """The legal range of every writable setting, so a caller can compose a valid payload.

    Served rather than documented: the write path enforces ``FIELD_BOUNDS`` and this reads
    the same dict, which is the ADR-0056 rule — a value vocabulary the client cannot see is
    a blank box behind every meaning.
    """
    return {key: {"min": lo, "max": hi} for key, (lo, hi) in FIELD_BOUNDS.items()}


def update(db: Session, updates: dict) -> dict[str, int]:
    """Persist scheduler overrides. Out-of-range values are refused, never clamped."""
    return update_system_settings(db, updates)


def update_llm(db: Session, updates: dict) -> dict:
    """Persist an assistant provider override. Takes effect on the next message sent —
    ``services/llm.get_provider`` reads it per-request, not once at process start."""
    return llm_settings.update(db, updates)


def ical_token(db: Session) -> dict:
    """The global calendar feed token, minted on first ask, with the path to subscribe to.

    A path rather than a URL, for the ADR-0084 reason: behind a reverse proxy the server's
    idea of its own origin is whatever the last hop claimed, and the caller already knows
    the real one.
    """
    token = get_global_ical_token(db)
    return {"token": token, "path": f"/ical/all/{token}.ics"}


def rotate_ical_token(db: Session) -> dict:
    """Issue a new feed token. Every subscribed calendar client stops updating."""
    token = rotate_global_ical_token(db)
    return {"token": token, "path": f"/ical/all/{token}.ics"}
