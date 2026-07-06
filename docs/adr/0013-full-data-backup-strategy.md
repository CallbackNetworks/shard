# ADR-0013: Full-Data Backup Strategy

## Status
Accepted

## Date
2026-07-06

## Context
The platform is self-hosted and single-user; the database (SQLite by default)
and uploaded attachment files are the only copies of the user's data. Per-project
JSON export existed, but there was no whole-instance backup, no automation, and
no way to recover from an accidental `rm`, a bad migration, or disk failure
without manual filesystem copies. The biggest realistic threat is operator
error, not attackers.

Options considered:
1. **Copy the SQLite file** — simple, but breaks for the PostgreSQL/MySQL
   backends supported since ADR-0007, and misses uploaded files.
2. **Database-native dump tools** (`pg_dump`, `mysqldump`) — per-backend code
   paths and extra binaries in the image.
3. **Serialize through the ORM to JSON** — backend-agnostic, and iterating
   `Base.metadata.sorted_tables` means new tables are included automatically
   with zero maintenance.

## Decision
Implement option 3 (`services/backup.py`): every table is dumped to
`data.json`, packed into a zip together with `meta.json` (format version,
timestamp, per-table row counts) and the contents of `/app/uploads`.

Delivery paths:
- `GET /backup/export` streams a freshly built archive as a download (nothing
  stored server-side); `POST /backup/run` and `GET /backup/status` manage
  server-side archives; `GET /backup/download/{filename}` serves them with a
  strict filename whitelist to prevent path traversal.
- The hourly scheduler writes one archive per day at `backup_hour` and prunes
  beyond `backup_keep` (both runtime-adjustable per ADR-0011, with
  `BACKUP_*` env defaults; automatic backup is on by default).
- Archives default to `/app/data/backups`, inside the `./data` bind mount that
  both dev and prod compose files already persist — no new volumes required.

Restore is deliberately out of scope for this ADR: archives are plain JSON, so
recovery is possible by hand or by a future import endpoint, and an automated
restore endpoint would be a destructive operation needing its own design.

## Consequences
Positive:
- One code path covers SQLite, PostgreSQL, and MySQL, and survives schema
  growth without edits.
- Daily archives on by default: operator error now has an undo, and archives
  live outside the DB file so DB corruption does not take the backups with it.
- Streamed export gives an easy off-machine copy (download to another device).

Negative:
- JSON dumps are larger and slower than native dumps; acceptable at
  personal-tool scale (thousands of rows).
- Backups default to the same disk as the live data; off-site copies remain
  the operator's responsibility (`BACKUP_DIR` can point at other storage).
- No automated restore yet — recovery is manual until an import path is built.
- The archive contains everything, including webhook secrets and API key
  hashes; backup files must be protected like the database itself.
