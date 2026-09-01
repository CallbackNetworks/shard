# ADR-0138: A bind mount the clone does not carry is created by root

## Status
Accepted

## Date
2026-09-01

## Context

[ADR-0117](0117-someone-who-is-not-us-can-run-this.md) says the whole install is
`git clone && docker compose -f docker-compose.selfhost.yml up -d`. Run against a clone
that has never had anything else run in it, that command fails:

```
sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) unable to open database file
ERROR:    Application startup failed. Exiting.
dependency failed to start: container shard-fresh-backend-1 is unhealthy
```

The backend bind-mounts `./data` and `./uploads`. Both are gitignored, so a fresh clone
does not contain them, so Compose asks the daemon to create the paths — and the daemon
runs as root, so they come out `root:root`. The backend image declares `USER app`
(uid 1000, deliberately, so it can write into a checkout the host user owns), and uid
1000 cannot create a file in a root-owned directory. SQLite reports that as "unable to
open database file", which reads like a path problem and is a permissions one. The
frontend then never starts at all, because it waits on the backend's health.

This has been broken since ADR-0117 shipped and nobody noticed, for the reason such
things are never noticed: on the machine it was written on, `./data` and `./uploads`
already existed — the dev stack had made them, months earlier, owned by the developer.
The failure needs a clone that has only ever been used for this, which is exactly the
state every other person is in and no maintainer ever is.

It was found by running the documented command in a throwaway clone against the
just-published images ([ADR-0137](0137-the-images-are-published-where-somebody-can-pull-them.md)),
which is the first time anybody had.

## Decision

**The directories are part of the repository; only their contents are ignored.**
`data/.gitkeep` and `uploads/.gitkeep` are tracked and `.gitignore` becomes `data/*` +
`!data/.gitkeep`. A clone therefore already has both paths, owned by whoever cloned,
and the daemon never creates them. This also covers the dev stack, which mounts the
same `./data`.

**And the container's user is overridable**: `user: "${SHARD_UID:-1000}:${SHARD_GID:-1000}"`
on the self-host backend. Shipping the directories fixes the ownership *class* — they
now belong to a human rather than root — but not the case where that human is not uid
1000. The default keeps today's behaviour exactly; `id -u` / `id -g` in `.env` covers a
host where the first account is not 1000, and `.env.example` names the symptom so the
error message can be searched for.

A named volume would have fixed both at once, since Docker seeds one from the image and
keeps its ownership. It is rejected for ADR-0117's reason: a self-hoster must be able to
see, copy and back up their data without knowing what a named volume is, and "your data
is these two directories" stops being true the moment it moves inside Docker.

## Consequences

**Positive.** The documented install works on a machine that has never run anything
else — verified end to end: fresh clone, published images, `up -d`, backend healthy,
`GET /` 200, `GET /api/settings` reporting `"version": "1.0.0"`, and the SQLite files
appearing in `./data` owned by the host user. The uid escape hatch was verified too, by
chowning both directories to 1001 and setting `SHARD_UID`/`SHARD_GID` to match.

**Negative.** Two empty tracked files whose purpose is not visible from their name. The
`.gitignore` comment carries the reason, since that is where somebody deleting them
would look.

**Negative.** `SHARD_UID` is a setting a self-hoster has to know they need, and they
learn it from a failure. The failure is at least loud — the container exits and the
health check never passes, rather than the app running and misbehaving later.

**The guard.** A `selfhost-install` job now runs the documented command against a clean
tree and asserts four things: the checkout carries `data/` and `uploads/`, the backend
becomes healthy, nginx serves the SPA *and* proxies `/api` to it, and `data/shard.db`
ends up owned by uid 1000 — the last because a health check only reads, and the failure
this ADR is about would otherwise be able to return as a stack that comes up green and
dies on the first write. No other job could have caught it: every one of them runs
against `docker-compose.ci.yml`, which has no bind mounts.

It needs one piece of stagecraft. The job talks to the host's Docker daemon, so a
relative bind mount in the compose file is resolved by the daemon rather than in the
job's own filesystem: `./data` under the workspace would become a stray root-owned
directory on the host and the run would prove nothing. The tree is copied to an absolute
host path through a helper container — the same move the deploy job makes for
`$DEPLOY_DIR` — and chowned to 1000, standing in for a clone owned by a person rather
than by the runner's root.

Only `publish-public` depends on it. A broken self-host install must not be published to
strangers, and must not block production's own deploy — that is ADR-0137's lesson, one
job later.
