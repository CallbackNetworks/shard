# ADR-0140: An upgrade stops first, and keeps what it replaces

## Status
Accepted

## Date
2026-09-01

## Context

[ADR-0136](0136-an-install-has-an-upgrade-path-and-a-version.md) gave a self-hoster an
upgrade command whose whole point was the migration step nothing else ran. It ordered
that step as build → migrate → start, with the old stack still running while the
migration applied, and it kept nothing.

The deploy pipeline this was modelled on does better on one of those counts: it takes a
snapshot of the data directory before migrating, keeps the last five, and can roll the
images back. Its snapshot is a `cp -a` of a live directory, which is a compromise it can
afford (production runs Postgres in some deployments, and its rollback path is images
rather than data) and which a SQLite self-hoster cannot: a WAL-mode database copied out
from under a running process is a torn file, and a torn file is not a rollback.

So the self-hoster had the strictly worse deal — no snapshot at all, and a migration
applied underneath a running application. A failed migration on a personal instance is
the case where somebody has no colleague, no runbook and no second copy.

## Decision

**Stop, then snapshot, then migrate, then start.** `scripts/upgrade.sh` becomes
build → stop → snapshot → migrate → start, failing the upgrade at the first error.

Stopping is what makes the snapshot worth taking — nothing is writing, so the archive
is a consistent database rather than a plausible-looking one — and it also means the
migration runs against a quiescent file. The cost is a few seconds of downtime on a
single-user tool that is being upgraded on purpose.

**The snapshot goes in a Docker volume** (`shard-snapshots`, last five kept), for
[ADR-0139](0139-the-self-host-stack-keeps-its-data-in-a-volume.md)'s reason: a host
directory this script had to create would be created as root. It is taken with
`docker run --volumes-from <backend>`, so it copies whatever the backend actually has
mounted and cannot name the wrong volume even when the project was brought up under a
different name.

The script prints the restore command, with the container looked up rather than
hardcoded — `up -d` replaces the container it just used, so a literal id would be stale
by the time anyone read it.

This is a rollback for the *database*. It is not a backup: it lives in Docker beside the
thing it protects, and five of them is a window of five upgrades. **Settings → Backup**
remains the answer to "keep a copy somewhere else".

## Consequences

**Positive.** A failed migration is recoverable by one printed command instead of by
whatever the person happens to have. Upgrading is now the safest thing a self-hoster
does rather than the most dangerous.

**Negative.** Every upgrade now has downtime where before the app kept serving until the
new containers came up. For a single-user tool being upgraded deliberately this is not
a cost worth optimising away, but it is a real behaviour change.

**Negative.** The snapshot covers `/app/data` — the database and the app's own backup
archives — and not `/app/uploads`. Attachments are content-addressed files that a
migration does not rewrite, so the rollback case does not need them, but "snapshot"
suggests more than it delivers and somebody will read it that way.

**Negative.** Snapshots accumulate inside a volume nobody looks at, and five of them on
a large instance is real disk. `docker volume rm shard-snapshots` is the whole cleanup
and nothing points at it from inside the app.
