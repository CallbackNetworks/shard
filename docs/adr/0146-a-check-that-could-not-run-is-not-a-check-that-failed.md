# ADR-0146: A check that could not run is not a check that failed

## Status
Accepted

## Date
2026-09-04

## Context

[ADR-0145](0145-the-audit-gate-blocks-on-what-can-be-fixed.md) raised the `npm audit`
threshold to `high` so that a wave of moderate advisories, fixable only by a major
upgrade, would stop blocking every deploy. The very next run failed anyway, on the same
step, with every test in the job green:

```
npm warn audit 503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick
npm error audit endpoint returned an error
```

`npm audit` computes nothing locally. It posts the dependency tree to npm's servers and
renders the answer, so when that endpoint is down the command exits non-zero having
learned nothing at all. The exit code is the same one it uses for "I found
vulnerabilities", and the pipeline treated it the same way: `Publish Docker images`,
`Publish public images`, `Self-host install` and `Deploy to production` were all skipped
because npm had a bad afternoon.

Those are two different events wearing one exit code:

- **A finding.** This repository depends on something with a known vulnerability. Acting
  on it is within reach — a lockfile bump, or an upgrade.
- **An outage.** A third party is unavailable. Nothing about this repository is known,
  nothing about it can be done, and waiting is the only available response.

Treating the second as the first makes production's deployability a function of npm's
uptime. That is a dependency nobody chose and nobody can act on, and it had already
queued two fixes behind it —
[ADR-0142](0142-an-unset-status-is-open-in-sql-too.md)'s correctness fix and
[ADR-0144](0144-the-install-check-runs-where-the-installer-runs.md)'s repair of the
install check.

## Decision

**Findings fail. An unreachable endpoint is retried, then reported without failing.**

`scripts/npm-audit-gate.sh` wraps the audit command, and both gates call it — the
frontend's and the e2e package's — so the classification exists once. It runs the
command, and on a non-zero exit reads the output: text matching `audit endpoint returned
an error` (or a connection error) is an outage, retried up to three times twenty seconds
apart; anything else is a report, printed, and the step fails.

When every attempt hits the outage the step **passes and prints two `::warning::` lines
saying that nothing was checked**, naming re-running the job as the fix. That warning is
the entire mechanism, and it is weak — this is the honest description of what is being
traded, not a footnote. The alternative is stronger and worse: keeping production's
deploy pipeline hostage to a service whose availability nobody here controls.

Classification is on the message rather than the exit code because npm uses one code for
both. That is fragile — the wording is not a contract — which is why the failure
direction is chosen deliberately: an unrecognised message falls through to *fail*, so a
future rewording of npm's error turns this back into today's behaviour rather than into
a gate that silently passes everything.

## Consequences

**Positive.** An npm outage no longer stops a deploy, and the gate is unchanged for the
case it exists for: a real `high` finding still fails the job, verified by driving the
script through all three branches — clean, findings, endpoint down.

**Positive.** The two audit steps share one implementation, so the retry schedule and the
classification cannot drift apart the way two copies would.

**Negative, and the point of this document.** A run during an npm outage checks nothing
and is green. Combined with ADR-0145 that is two layers of "this gate is quieter than it
looks", and only the warning lines distinguish the second from a real pass. Nobody reads
the output of a green job.

**Negative.** Matching on npm's error text is matching on something npm may change
without notice. The failure direction is safe, but a reworded error would silently
restore the outage-blocks-deploy behaviour, and the symptom would be indistinguishable
from npm being slow.

**Negative.** Three attempts twenty seconds apart covers a blip, not an hour. A longer
outage still ends in the pass-with-warning path, which is the design, but it means the
window in which nothing is checked can be as long as npm's downtime rather than a
minute.
