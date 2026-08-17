"""External API v1 — system settings, backups and the calendar feed token (ADR-0091).

The operational half of what was still browser-only. Reading and changing how this instance
behaves — when the daily summary goes out, how far ahead "due soon" looks, whether and when
a backup runs — and taking or restoring a backup. Both doors call ``services/settings_admin``
and ``services/backup_admin``; neither writes a refusal (ADR-0085).

Scopes follow what the response carries, not how the act feels:

* ``read`` for state — the settings themselves, their legal ranges, what backups exist.
* ``admin`` for every write, and for every read that hands over a copy of the database. An
  export is not a report about the data, it *is* the data, credentials and all, so it cannot
  be a ``read``-scope response; and the settings write can turn off the daily backup or set
  retention to one, which quietly removes the recovery path for every other caller.
"""

import base64
import binascii

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey
from app.routers.external_api.auth import _auth_errors, _get_api_key, _require_scope
from app.services import backup_admin, settings_admin
from app.services.errors import Invalid
from app.services.settings_admin import LLMSettingsUpdate, SystemSettingsUpdate

sub_router = APIRouter()


# ── System settings ─────────────────────────────────────────────────


@sub_router.get(
    "/settings",
    summary="How this instance is configured",
    description=(
        "Effective scheduler settings (`summary_hour`, `due_soon_window_hours`, "
        "`reminder_cooldown_hours`, `backup_enabled`, `backup_hour`, `backup_keep`) merged "
        "over their environment defaults, plus non-sensitive facts about the process: which "
        "auth mode is active, which LLM provider is configured, whether SMTP is set up. No "
        "credential is included — `smtp_configured` is a boolean about a password, not the "
        "password. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_get_settings(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return settings_admin.read(db)


@sub_router.get(
    "/settings/bounds",
    summary="The legal range of every writable setting",
    description=(
        "`{setting: {min, max}}`, read from the same table the write path enforces. Call it "
        "before composing a settings write: an out-of-range value is refused (422), not "
        "clamped, so a payload built by guessing fails loudly instead of being partly "
        "applied. Requires `read` scope."
    ),
    responses=_auth_errors,
)
def api_get_settings_bounds(api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return settings_admin.bounds()


@sub_router.put(
    "/settings/system",
    summary="Change the scheduler's timings",
    description=(
        "Partial update; omitted fields are left alone and an unknown field is a 422 rather "
        "than a silent no-op. Takes effect on the next scheduler tick without a restart "
        "(ADR-0011). Requires `admin` scope: `backup_enabled` and `backup_keep` decide "
        "whether this system can be recovered at all."
    ),
    responses=_auth_errors,
)
def api_update_settings(
    body: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    return settings_admin.update(db, body.model_dump(exclude_none=True))


@sub_router.put(
    "/settings/llm",
    summary="Change the assistant's provider",
    description=(
        "Partial update of `provider` (`claude`|`openai`|`stub` — a wire protocol, not a "
        "vendor), `model`, `api_key` and `base_url`. `base_url` reaches any endpoint that "
        "speaks the same protocol — Cloudflare AI Gateway, a self-hosted OpenAI-compatible "
        'gateway — without a new `provider` value. A field left out is unchanged; `""` '
        "clears that field's override back to its environment default. Takes effect on the "
        "next message sent, no restart needed. When `model` is part of the request, the "
        "response carries a best-effort `model_check` ({checked, ok, detail}) from querying "
        "the provider's own model list — `checked: false` means no verdict could be reached "
        "(package not installed, endpoint unsupported, network failure), not that the model "
        "is wrong; it never blocks the write. Requires `admin` scope, on the same rule as "
        "`/settings/ical-token`: the key is a credential, and this is the only door that can "
        "set one."
    ),
    responses=_auth_errors,
)
def api_update_llm_settings(
    body: LLMSettingsUpdate,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    return settings_admin.update_llm(db, body.model_dump(exclude_none=True))


@sub_router.get(
    "/settings/ical-token",
    summary="The calendar feed token for every project",
    description=(
        "Returns the global iCal `token` and the `path` to subscribe to "
        "(`/ical/all/{token}.ics`), minting one on first request. A path, not a URL: behind "
        "a reverse proxy the server's idea of its own origin is whatever the last hop said. "
        "Requires `admin` scope — the token *is* the feed, and the feed is every task's "
        "title and due date without any further authentication."
    ),
    responses=_auth_errors,
)
def api_get_ical_token(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    return settings_admin.ical_token(db)


@sub_router.post(
    "/settings/ical-token/rotate",
    summary="Rotate the calendar feed token",
    description=(
        "Issues a new token and returns it with its path. Every calendar client already "
        "subscribed stops updating and has to be re-pointed, so do this when the URL has "
        "leaked, not as routine hygiene. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_rotate_ical_token(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    return settings_admin.rotate_ical_token(db)


# ── Backups ─────────────────────────────────────────────────────────


@sub_router.get(
    "/backup/status",
    summary="Backup schedule and the archives on disk",
    description=(
        "Whether the daily backup is enabled, the hour it runs (UTC), how many archives are "
        "retained, and the list of archives with their sizes and timestamps. Requires `read` "
        "scope: this describes the backups, it does not hand one over."
    ),
    responses=_auth_errors,
)
def api_backup_status(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "read")
    return backup_admin.status(db)


@sub_router.post(
    "/backup/run",
    summary="Take a backup now",
    description=(
        "Writes a server-side archive immediately and applies retention, pruning the oldest "
        "beyond `backup_keep`. The obvious call to make before a bulk change you are not "
        "sure about. Requires `admin` scope — it deletes older archives."
    ),
    responses=_auth_errors,
)
def api_backup_run(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    return backup_admin.run(db)


@sub_router.get(
    "/backup/export",
    summary="Download a fresh archive without storing it",
    description=(
        "Builds an archive in memory and returns it as `application/zip`; nothing is written "
        "to the server and retention is untouched. Requires `admin` scope: the archive is "
        "the whole database, including every share token, callback token and signing secret "
        "that ADR-0059 keeps out of ordinary responses."
    ),
    responses=_auth_errors,
)
def api_backup_export(db: Session = Depends(get_db), api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    data, name = backup_admin.export(db)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@sub_router.get(
    "/backup/download/{filename}",
    summary="Download an existing archive",
    description=(
        "By the filename reported in `GET /backup/status`. Requires `admin` scope, for the "
        "same reason as `/backup/export`."
    ),
    responses=_auth_errors,
)
def api_backup_download(filename: str, api_key: ApiKey = Depends(_get_api_key)):
    _require_scope(api_key, "admin")
    path = backup_admin.archive_path(filename)
    # Not FileResponse: the redaction middleware only walks JSON, but an `admin` key is the
    # only caller here anyway and a plain body keeps the two doors byte-identical.
    return Response(
        content=path.read_bytes(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class RestoreRequest(BaseModel):
    """An archive as base64, for callers that cannot build a multipart upload.

    The same two-door shape attachments got in ADR-0086: the SPA posts multipart, an agent
    posts JSON, and both land in one implementation so the confirmation guard exists once.
    """

    archive_base64: str = Field(description="The .zip archive, base64-encoded")
    confirm: str = Field(default="", description='Must be exactly "replace"')


@sub_router.post(
    "/backup/restore",
    summary="Replace everything with an uploaded archive",
    description=(
        "**Destructive and irreversible.** Replaces all data with the archive's contents; "
        'requires `confirm: "replace"`. The restore runs in one transaction, so a '
        "malformed archive (422) leaves the live data untouched. Requires `admin` scope."
    ),
    responses=_auth_errors,
)
def api_backup_restore(
    body: RestoreRequest,
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    try:
        data = base64.b64decode(body.archive_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise Invalid("archive_base64 is not valid base64") from exc
    return backup_admin.restore_bytes(db, data, confirm=body.confirm)


@sub_router.post(
    "/backup/restore/{filename}",
    summary="Replace everything with an archive already on the server",
    description=(
        "**Destructive and irreversible.** Same act as `/backup/restore`, sourced from an "
        "archive listed by `GET /backup/status`. Requires `confirm=replace` and `admin` scope."
    ),
    responses=_auth_errors,
)
def api_backup_restore_file(
    filename: str,
    confirm: str = Query("", description='Must be exactly "replace"'),
    db: Session = Depends(get_db),
    api_key: ApiKey = Depends(_get_api_key),
):
    _require_scope(api_key, "admin")
    return backup_admin.restore_file(db, filename, confirm=confirm)
