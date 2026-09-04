#!/usr/bin/env bash
# Run an `npm audit` command as a CI gate, and tell two different things apart.
#
# `npm audit` exits non-zero for two unrelated reasons: it found vulnerabilities at or
# above the threshold, or it could not reach the registry's audit endpoint at all. The
# first is a finding about this repository. The second is a fact about npm's uptime,
# and on 2026-09-04 it stopped production deploying for exactly that reason — a 503 from
# `registry.npmjs.org/-/npm/v1/security/audits/quick`, with every test in the job green.
#
# So: findings fail, an unreachable endpoint is retried and then reported without
# failing. That second half is a real hole and is stated rather than hidden — a run
# during an outage checks nothing, and the loud warning is the whole mechanism telling
# anyone. It is the lesser of the two: blocking every deploy on a third party's
# availability is a bigger hole, and the one that was actually costing something.
#
# Usage: scripts/npm-audit-gate.sh <the whole npm audit command>
#   scripts/npm-audit-gate.sh docker compose -f docker-compose.ci.yml \
#     run --rm frontend npm audit --audit-level=high
#
# NPM_AUDIT_ATTEMPTS / NPM_AUDIT_RETRY_SECONDS override the retry schedule (tests do).

set -uo pipefail

attempts="${NPM_AUDIT_ATTEMPTS:-3}"
delay="${NPM_AUDIT_RETRY_SECONDS:-20}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# The string npm prints when the endpoint answered with anything but a report. Matched
# rather than inferred from the exit code, because both cases exit 1.
UNREACHABLE='audit endpoint returned an error|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up'

for attempt in $(seq 1 "$attempts"); do
  if "$@" >"$log" 2>&1; then
    cat "$log"
    exit 0
  fi

  if grep -qE "$UNREACHABLE" "$log"; then
    echo "npm's audit endpoint did not answer (attempt ${attempt}/${attempts})"
    [ "$attempt" -lt "$attempts" ] && sleep "$delay"
    continue
  fi

  # A real report. This is the gate doing its job.
  cat "$log"
  exit 1
done

cat "$log"
echo
echo "::warning::npm audit did not run: the registry's audit endpoint was unavailable for all ${attempts} attempts."
echo "::warning::NOTHING WAS CHECKED for vulnerabilities in this run. Re-run this job once npm is back."
exit 0
