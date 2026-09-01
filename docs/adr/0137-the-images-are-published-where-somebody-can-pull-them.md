# ADR-0137: The images are published where somebody can pull them

## Status
Accepted

## Date
2026-09-01

## Context

[ADR-0117](0117-someone-who-is-not-us-can-run-this.md) made the install one command by
building the production images from the checkout. That was the right first move — it
needs no registry account and no credentials — but it means every self-hoster's first
command compiles a frontend bundle and resolves a Python dependency tree on their
machine, and every upgrade does it again. On a small VPS that is ten minutes and enough
memory to matter, for an artifact CI has already built and tested.

The pipeline does publish images, but to this project's own private registry
(`vars.REGISTRY_URL`), because their only consumer was the deploy job. Nobody outside
can pull them, and nothing in the repository named a public location.

The compose file's image names were `${SHARD_IMAGE_PREFIX:-shard}/backend` — a shape
Docker Hub cannot hold. A Docker Hub repository is `namespace/name` with no nested path,
so `callbacknetwork/shard/backend` is not a name that can exist there.

## Decision

**Publish the images the integration job already proved, to a public registry, under a
version tag that never moves.**

A `publish-public` job, gated on `vars.PUBLIC_REGISTRY_URL` — the same pattern ADR-0135
used for the private registry, where the variable *is* the switch. A fork with neither
variable skips both jobs.

**Its own job, and nothing depends on it.** The first version of this shipped as a second
half of `publish`, and the very first run proved why that is wrong: the Docker Hub token
turned out to be read-only, the push failed, and `deploy` — which `needs: [publish]` —
never ran. An optional convenience had taken production's release with it. The two
registries answer different questions ("can the deploy pull this?" and "can a stranger
pull this?"), so they are two jobs, and a public-registry problem is a red job of its own
rather than a blocked deploy.

Three properties are deliberate:

- **Re-tagged, never rebuilt.** The public images are the same layers the integration
  job started, health-checked and ran Playwright against. A second build here would be a
  second artifact, tested by nothing, differing from the tested one by whatever moved in
  the intervening minutes.
- **A version tag is immutable; `latest` moves.** `docker manifest inspect` decides:
  if `1.0.0` is already published, the push is skipped and said so out loud. Without
  that, every merge to `main` would silently replace the build somebody pinned. The
  version comes from `backend/pyproject.toml` ([ADR-0136](0136-an-install-has-an-upgrade-path-and-a-version.md)),
  so bumping that file is what cuts a release.
- **Flat names.** `<prefix>-backend` / `<prefix>-frontend`, because of the Docker Hub
  constraint above. The private registry keeps its three-level prefix; the two schemes
  do not have to agree, and forcing them to would mean changing the deploy path for a
  reason that has nothing to do with it.

Pulling stays opt-in: `docker-compose.selfhost.yml` still carries `build:` beside
`image:`, so a bare clone with no variables set builds exactly as before. Setting
`SHARD_IMAGE_PREFIX` and `SHARD_TAG` turns the same file into a pull.

## Consequences

**Positive.** A self-hoster can install and upgrade without a toolchain: two variables
and `docker compose pull`. Pinning a version now means something, because that tag will
not change under them.

**Negative.** The project now has a public artifact with a maintenance expectation
attached. An image published under a version tag is permanent in a way a git tag is not
— a bad release cannot be quietly replaced, only followed by a better one.

**Negative.** Two naming schemes for the same two images (three-level for the private
registry, flat for the public one). They are computed in one step each and neither is
derived from the other, so the risk is confusion when reading, not drift.

**Negative.** `publish-public` re-tags images the `integration` job left on the runner,
which assumes both jobs share a Docker daemon. That is already true of `publish`, and
true of any self-hosted setup, but it would not hold on ephemeral hosted runners — where
neither job runs, because neither registry variable is set there.

**Negative.** Nothing verifies that the published images are pullable — the pipeline
pushes and stops. The first person to run `docker compose pull` is the test, and the
`build:` fallback is what keeps that from being a dead end.
