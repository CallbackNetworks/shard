# ADR-0024: Backup Restore Endpoint

## Status
Accepted

## Date
2026-07-11

## Context
ADR-0013 shipped whole-instance backups (every table serialized to JSON plus
uploaded files, packed into a zip) but deliberately left restore out of scope:
recovery meant hand-editing JSON or writing a one-off import script. An
unverified restore path is not a real backup — a daily archive that has never
been proven to reload is only a guess. As data accumulates, that gap grows more
expensive to discover the hard way.

Restore is destructive (it replaces the entire instance), and it must work
across all backends supported since ADR-0007. The hard parts are foreign keys:

- PostgreSQL and MySQL enforce FKs; SQLite in this project does not
  (`database.py` sets no `foreign_keys` pragma).
- `tasks` is self-referential (`parent_id -> tasks.id`), so even within one
  table a child row can be inserted before its parent.
- Managed PostgreSQL usually denies the superuser privilege needed for
  `session_replication_role = replica`, so disabling FK enforcement for the
  load is not portable.

## Decision
Add restore in `services/backup.py` (`restore_archive` / `restore_db` /
`restore_uploads`) and expose it via `POST /backup/restore` (multipart upload)
and `POST /backup/restore/{filename}` (existing server-side archive). Both
require `confirm="replace"` to guard against accidental clicks; the Settings UI
adds an upload button and a per-archive restore button, each behind a browser
confirm dialog.

FK-safe load without needing elevated privileges:
- Delete every table in reverse dependency order; `ondelete=CASCADE` covers
  self-referential rows.
- Insert in forward dependency order (`Base.metadata.sorted_tables`), and sort
  rows in self-referential tables parent-first via an iterative topological
  pass (`_order_rows_for_insert`).
- Coerce `DateTime` columns from ISO strings back to `datetime` on the way in
  (psycopg rejects strings in timestamp columns); Boolean and JSON survive the
  JSON round-trip natively.
- Run the whole thing in one transaction, so a malformed archive leaves live
  data untouched.

Validation rejects non-zip payloads, a missing `data.json`, an unsupported
`format_version`, and any table name not present in the current ORM metadata.

## Consequences
Positive:
- Backups are now proven recoverable end to end, verified by a roundtrip test
  that wipes data and restores it — run against both SQLite and PostgreSQL, so
  the FK-enforced path is covered (ADR-0020).
- One code path across all backends; no superuser requirement, so it works on
  managed PostgreSQL.
- Restore uses only ORM metadata, so new tables are handled automatically like
  backup already is.

Negative:
- Restore is all-or-nothing: it replaces the entire instance, not a selective
  merge. Partial/selective restore remains out of scope.
- An archive from a newer schema (unknown table, or a column dropped since) is
  rejected rather than partially applied; cross-version restore requires a
  matching or older schema. `format_version` gates the archive shape, not the
  table set.
- The confirm flag and dialog are the only safeguards; anyone who can reach the
  authenticated Settings page can overwrite all data.

## Supersedes
Reverses the "no automated restore" decision recorded in ADR-0013's Decision and
Consequences. ADR-0013 otherwise stands.
