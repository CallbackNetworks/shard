# ADR-0144: The install check runs where the installer runs

## Status
Accepted

## Date
2026-09-02

## Context

[ADR-0139](0139-the-self-host-stack-keeps-its-data-in-a-volume.md) added a CI job that
performs the documented install on every push, because the one-command install had been
broken from ADR-0117 until somebody stood where a stranger stands. The job has failed on
every run since the commit that introduced it. Nobody saw it, because the `npm audit`
failure in the frontend job was failing first and this job never got to run; when that
was cleared, this one surfaced with the same error it had produced the first time:

```
open /tmp/shard-selfhost-ci-571/docker-compose.selfhost.yml: no such file or directory
```

The job copied the checkout to an absolute path on the *host* — through a helper
container, because this runner is docker-out-of-docker — and then ran
`docker compose -f "$SELFHOST_DIR/docker-compose.selfhost.yml"` against it.

Those are two different filesystems. The helper container's bind mount writes to the
daemon's host; the compose command runs inside the job's own container, and
`docker compose -f` opens that file **locally**, before it contacts the daemon at all.
The path existed on the host and did not exist where the command ran. Reproduced
outside CI in a container with the socket mounted: writing through a helper container to
`/tmp/X` leaves `/tmp/X` absent in the writing container and present on the host.

The copy step exited 0 while achieving nothing, which is why the failure surfaced one
step later as a missing file rather than as a failed copy. `tar cf - .` produced its
stream, the helper's busybox `tar xf -` consumed it, and the pipeline's status was the
helper's. Nothing then checked that the tree had arrived anywhere the job could read.

The reason for the copy had also expired. A path in a compose file needs to exist on the
daemon's filesystem only when it is a **bind mount** — and ADR-0139 replaced this stack's
bind mounts with named volumes. What is left is `build.context: ./backend` and
`./frontend`, which the *client* reads and streams to the daemon, and two named volumes,
which need no path at all. So the decision that made the copy necessary was reversed by
ADR-0139, and the copy step became pure liability in the same commit that made it
pointless.

## Decision

**Run the documented command from the checkout, which is where somebody who just cloned
the repository runs it.** `$SELFHOST_DIR` and the copy step are gone; every step now
addresses `docker-compose.selfhost.yml` by its relative name.

The one remaining divergence from what a stranger types is `-p ci-selfhost-<run id>`,
which scopes the compose project so two runs cannot collide and so `Cleanup` removes this
run's volumes and no one else's. That is worth its cost. The copy was not: it made the
job's subject a *copy* of the tree in a place the job could not see, and the further a
check drifts from the command it is checking, the less its green tells you.

A step asserts the compose file and its two build contexts are readable from where
compose runs, before the `up`. That is precisely the condition that was false, and the
assertion exists because the previous failure mode was silence rather than an error.

## Consequences

**Positive.** The job now runs the README's command on the README's tree, so a green
result means what its name claims. The install itself was never broken — verified by
hand, and again in a docker-out-of-docker container reproducing the runner's situation:
all four of the job's assertions pass.

**Positive.** `Publish public images` depends on this job, so public images resume. They
have been stuck since the last run before ADR-0139, which means self-hosters pulling
`latest` have had none of the work since — including the upgrade script ADR-0140 shipped
for them.

**Negative.** The job builds in the job container's own workspace now, so its build
context is streamed from a volume rather than read from a host path. That is the normal
path and it is what a self-hoster does, but it does mean the job no longer exercises the
"compose file living at an absolute path" case — which the deploy job does, and which is
its own job's business.

**Negative.** This was found by a person asking why a job was red, not by anything in the
repository. A check that has never once passed looks exactly like a check that is
working, and nothing distinguishes them: there is no assertion anywhere that a guard job
has ever been green. That gap is real and is not closed here.

**Negative.** While reproducing the fix the host ran out of Docker address pools — the
same exhaustion recorded on 2026-08-27 — because ten CI networks from finished runs were
still present. `preflight` only reclaims networks older than three hours, deliberately,
so that a concurrent run's network is never removed underneath it. On a host this busy
that window is too wide, and the ceiling is a property of the host rather than of this
workflow, so it will happen again.
