# ADR-0139: The self-host stack keeps its data in a volume

## Status
Accepted

## Date
2026-09-01

## Context

[ADR-0117](0117-someone-who-is-not-us-can-run-this.md) put the self-hoster's database
and attachments in bind mounts — `./data` and `./uploads` beside the compose file — for
a good reason: "your data is these two directories" is something a person can act on
without knowing what Docker is, and it makes copying an instance a `cp -r`.

The price arrived as [ADR-0138](0138-a-bind-mount-a-clone-does-not-carry-is-created-by-root.md):
a bind-mounted host directory carries the *host's* ownership, and a path Compose has to
create is created by the daemon as root, which the app — running as uid 1000 — cannot
write. The documented one-command install failed for three months without anyone
noticing. ADR-0138 fixed it by tracking the directories so a clone carries them, and
added `SHARD_UID`/`SHARD_GID` for a host whose user is not 1000.

That fix works, and it leaves the coupling in place: the app's ability to start still
depends on who owns a directory on the host and whether those two numbers match. Docker's
own guidance is that volumes are the mechanism for persistent container data, and the
reason applies exactly here — Docker seeds a fresh named volume from the image's copy of
the directory, and `Dockerfile.prod` creates `/app/data` and `/app/uploads` and chowns
them to the app user. A volume therefore arrives already owned by the process that will
write to it, on every host, whatever uid the person running it happens to have.

## Decision

**The self-host stack's data goes in named volumes**, `shard-data` and `shard-uploads`,
and `SHARD_UID`/`SHARD_GID` are removed along with the coupling that needed them.

This supersedes ADR-0138's `user:` override entirely. It does **not** supersede the
tracked `data/` directory: the *dev* stack still bind-mounts `./data`, so a fresh clone
must still carry it, and `.gitignore` keeps `data/*` + `!data/.gitkeep` for that reason
alone. `uploads/` is no longer mounted by anything in the repo and is gone.

The reachability that made bind mounts attractive is replaced rather than dropped, which
is the condition for making this trade at all:

- **Settings → Backup** already exports the whole instance and downloads it (ADR-0013,
  ADR-0091). That path existed before this ADR and is now the first thing the docs point
  at, because it is the one a non-technical self-hoster can use.
- The README and deployment doc carry the two-line `docker run … tar` for copying a
  volume out and back, so "how do I get my data" has a printed answer rather than an
  assumed one.

**`down -v` is now the destructive command**, where before it was `rm -rf ./data`. The
docs say so where they say anything about stopping the stack.

## Consequences

**Positive.** The install no longer depends on host uids at all: a fresh clone on any
machine, by any user, starts and writes its own database. The one setting a self-hoster
could get wrong (`SHARD_UID`) is gone rather than documented. This is also the shape most
readers expect, which matters for a public repository — an unusual choice costs a reader
attention even when it is defensible.

**Negative.** "Copy those two directories and you have copied the instance" was the
simplest true sentence in the README, and it is no longer true. It is replaced by a
command, and a command is worse than a directory listing for the audience this project
is trying to serve. This is the whole cost of the change, and it is real.

**Negative.** Anyone who installed before this has data in `./data` and will start with
an empty instance unless they move it into the volume first. The changelog carries the
one-line `docker run … cp -a`, but nothing detects the situation or warns about it: the
old directory is simply no longer read. A migration step that inspected the host
directory would have to run before the app starts and would reintroduce exactly the
host-path coupling this removes.

**Negative.** The data is now somewhere a person cannot point at in a file manager. On a
machine where somebody wants to look at their SQLite file with another tool, that is a
`docker run` away rather than a double-click.
