# ADR-0011: Runtime-Adjustable System Settings

## Status
Accepted

## Date
2026-07-05

## Context
Several scheduler behaviors were fixed at process start via environment
variables: the daily-summary send hour (`SUMMARY_HOUR`), the due-soon reminder
window (`DUE_SOON_WINDOW_HOURS`), and the reminder cooldown
(`REMINDER_COOLDOWN_HOURS`). Changing any of them required editing `.env` and
restarting the backend.

Because this platform is a single-user personal tool (not a team product),
these values are effectively user preferences rather than deployment
configuration. The Settings page already displayed the summary hour, but as a
read-only value — the most common "why can't I just change this?" friction
point. We wanted these adjustable from the UI, applied without a restart, while
keeping environment variables meaningful for fresh deployments.

## Decision
Introduce a small runtime-settings layer (`services/runtime_settings.py`) that
persists overrides in the existing `user_preferences` table under a single key
(`system-settings`). Effective values are computed as stored overrides merged
over environment/default values, and user input is clamped to safe bounds.

The scheduler reads these values from the database on each tick (it ticks
hourly, so the extra read is negligible) instead of from module-level
constants. The Settings API exposes the effective values via `GET /settings`
and accepts updates via `PUT /settings/system`.

Environment variables (`SUMMARY_HOUR`, `DUE_SOON_WINDOW_HOURS`,
`REMINDER_COOLDOWN_HOURS`) are retained as defaults/fallbacks, so existing
deployments and fresh installs behave identically until a value is overridden
in the UI.

## Consequences
Positive:
- Users change reminder timing and summary hour from the UI, effective on the
  next scheduler tick with no restart.
- No new table or migration — reuses the `user_preferences` key-value store.
- Environment defaults remain authoritative for unset values, preserving
  deployment reproducibility.

Negative:
- Adds one lightweight database read per scheduler tick and per settings load.
- Two sources of truth (env default vs. stored override) require the merge/clamp
  helper to stay the single access point; callers must not read the env vars
  directly for these fields.
- Overrides live in the application database, so they are not captured by
  `.env`-based configuration management.
