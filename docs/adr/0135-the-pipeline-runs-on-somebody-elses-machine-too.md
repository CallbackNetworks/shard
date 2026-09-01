# ADR-0135: The pipeline runs on somebody else's machine too

## Status
Accepted

## Date
2026-08-31

## Context

Every job in `.github/workflows/ci.yml` named its runner with a literal label:
`runs-on: ci-builder` for the seven check/build jobs, `runs-on: cd-deployer` for the
deploy. Those labels exist on exactly one Gitea instance — this project's — where a
single `act_runner` registers as `ci-builder:docker://catthehacker/ubuntu:act-latest`
and a second host answers to `cd-deployer`.

[ADR-0117](0117-someone-who-is-not-us-can-run-this.md) made the *product* runnable by
somebody who is not us. It did not touch the pipeline, and the pipeline is what a
contributor meets first. On a public GitHub repository, or on any fork of it, no runner
advertises `ci-builder`. The jobs are not rejected — they are queued, forever, with no
message naming what is missing. A contributor opening their first pull request sees
eight checks spinning and no output, which is worse than a red X: a failure at least
says something.

The reverse case is just as real. `publish` and `deploy` are gated on
`github.event_name == 'push' && github.ref == 'refs/heads/main'`, and a fork has a
`main` too. A contributor pushing to their own default branch got two jobs that try to
`docker login` to a registry variable that is empty and deploy to a host that is not
theirs — or, more likely, two more jobs queued forever behind a label nobody has.

Three ways out were considered:

1. **A second workflow file** for public runners, with the check steps copied into it.
   Rejected on this repository's most-repeated finding: a duplicate that still works has
   no failure symptom, and it drifts (ADR-0070, ADR-0087, ADR-0089). The two copies would
   describe the same suite and disagree the first time anyone edited one.
2. **Add `ubuntu-latest` to our own runner's labels**, so one literal serves both. This
   makes the workflow correct only as long as an out-of-band piece of runner
   configuration matches it, and the runner is registered against the whole instance, so
   it would start collecting unrelated repositories' jobs.
3. **Make the label a repository variable**, defaulting to the hosted runner.

## Decision

**Where a job runs is configuration, not source: `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`.**

The fallback points at the case that needs no setup — a fork, where `ubuntu-latest`
always exists — and the special case, this project's self-hosted runners, is one
repository variable each (`CI_RUNNER`, `CD_RUNNER`). That ordering is deliberate: the
person who can fix a missing variable is the maintainer who set the rest of the
instance up, not the contributor who cannot see it.

Gitea evaluating expressions in `runs-on` is load-bearing, so it was **probed against
the live runner** before being relied on, with a throwaway branch and a one-step job:
the runner's log shows `ci-builder-01 ... received task ... of job probe`. If it had not
been supported, the symptom would once again have been a queue rather than an error —
which is precisely the class of failure this ADR exists to remove, and not something to
discover on the next push to `main`.

**`REGISTRY_URL` is the switch for publishing and deploying**, not just a value they
read: `if: … && vars.REGISTRY_URL != ''`. "No registry configured" is exactly the
condition under which there is nothing to publish and nowhere to deploy, so the fork
case is expressed by the same variable that would otherwise be silently empty.

The `preflight` job — which reclaims containers and networks leaked by earlier runs on
the shared host ([ADR-0116](0116-ci-reclaims-what-earlier-runs-leaked.md)) — keeps
running everywhere, but its one step is gated on `vars.CI_RUNNER != ''`. The gate is on
the *step*, not the job, because the four check jobs declare `needs: [preflight]` and a
skipped job skips everything that needs it. On an ephemeral hosted runner there is
nothing to reclaim: the machine is discarded after the run.

## Consequences

**Positive.** A fork runs the full suite — both databases, the frontend, the production
integration smoke test — with zero configuration, and its `publish`/`deploy` jobs show
as skipped rather than pending. There is one workflow file, so a change to the suite
reaches everyone who runs it. The self-hosted setup is now visible as configuration
(three variables, documented in `docs/deployment.md`) instead of being spelled into
eight `runs-on:` lines.

**Negative.** The maintainer's instance now depends on two repository variables that are
not in the repository: if `CI_RUNNER` is unset there, its jobs ask for `ubuntu-latest`,
which its runner does not advertise, and they queue — the original failure mode, moved.
It is a one-time setup with a loud symptom on the very next push, and the alternative
was leaving that failure permanently pointed at everybody else instead.

**Negative.** The check jobs have never actually run on a GitHub-hosted runner; nothing
in this change could verify that, since the repository lives on Gitea. They use only
`docker compose` and GNU coreutils, both present on `ubuntu-latest`, but the first
public pull request is where that gets tested.
