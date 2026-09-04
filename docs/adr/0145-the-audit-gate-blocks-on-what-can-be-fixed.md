# ADR-0145: The audit gate blocks on what can be fixed

## Status
Accepted

## Date
2026-09-03

## Context

The frontend job has run `npm audit --audit-level=moderate` since the pipeline was
built, and `pip-audit --strict` covers the backend. The intent is sound: a dependency
with a known vulnerability should not reach production quietly.

Twice in two days that gate stopped production deploying for reasons that had nothing to
do with any change being shipped.

The first was `browserslist`, and it was the case the gate is for: two advisories, a
patch-level fix, one lockfile commit
(`3199b2b`). The gate did its job and the bill was ten minutes.

The second was different in kind. Twenty-seven moderate advisories landed against the
`@tiptap/*` family, and every fix path for every one of them resolves to a **major**
upgrade: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link` and
`@tiptap/extension-placeholder` from 2.27.2 to 3.31.0, plus `tiptap-markdown` 0.8.10 to
0.9.0. One `high` advisory arrived in the same wave (`fast-uri`) and was fixed the safe
way, in the same commit as this decision.

So the gate's demand was: upgrade the rich-text editor across a major version before
anything else ships. That editor is two files and nine import lines, but it is mounted in
six places — task create, task edit, decisions, the assistant conversation, `IssueRow`,
`TaskEditForm` — and `MarkdownEditor` has no test of its own. It is a real piece of work
that deserves a browser check, and none of that was the reason anyone was pushing that
day.

That is the shape of the problem, and it is not about severity levels in the abstract.
**A gate that cannot be satisfied except by unrelated work does not stop the risk; it
moves the pressure onto whoever is trying to ship something else.** The likely outcomes
are all bad ones: the upgrade gets done badly and in a hurry, or the gate gets bypassed
under time pressure, or production stops receiving fixes — which is itself a security
posture, and a worse one, since the queue behind this gate held the ADR-0142 correctness
fix and the ADR-0144 install check.

## Decision

**Both `npm audit` gates block at `high`, not `moderate`** — the frontend's and the
e2e package's.

The e2e tree is clean at `moderate` today and is changed anyway: two gates on one tool at
two thresholds is how the next advisory wave reproduces this outage in whichever one was
left alone.

Moderate findings are still printed by the step. What changes is that a person reads them
rather than the pipeline enforcing them, and that is the honest description of the
trade: this decision converts an automatic check into a manual one, and manual checks are
the kind that stop happening. It is taken because the automatic version was not enforcing
a standard, it was queuing an unrelated migration in front of every deploy.

`pip-audit --strict` on the backend is untouched. It has not exhibited this failure mode,
and a threshold changed pre-emptively on a gate that is working is a loosening bought
with nothing.

**The tiptap 2 to 3 upgrade is still owed.** It is deliberately not folded into this
commit: mixing a major upgrade of a core input component into a change whose purpose is
to unblock a pipeline is how an editor regression ships unexamined.

## Consequences

**Positive.** The queue drains. The correctness fix in
[ADR-0142](0142-an-unset-status-is-open-in-sql-too.md) and the install check in
[ADR-0144](0144-the-install-check-runs-where-the-installer-runs.md) reach production, and
the next unrelated push is not blocked by an advisory wave against a package it does not
touch.

**Positive.** `high` still gates, and still works — `fast-uri` in this very wave was
caught, fixed and shipped by the ordinary path.

**Negative, and the real cost.** Moderate advisories no longer stop anything. They are
the majority of what npm publishes, and nothing in this repository now notices when one
appears, when one goes unfixed for months, or when a package accumulates several. Whoever
reads the frontend job's output is the whole mechanism, and nobody reads a green job's
output.

**Negative.** This makes the tiptap upgrade easy to never do. The advisories that
prompted it stay open and stop being visible the moment this commit lands, which is
exactly the condition under which work gets forgotten. The upgrade being owed is recorded
here and nowhere that will interrupt anyone.

**Negative.** A threshold is a blunt instrument: it cannot say "these 27, for now" and it
cannot expire. A per-advisory exception list with dates would have said the true thing —
and would have meant a new CI dependency (`audit-ci` or similar) plus a list somebody
prunes. That option was considered and rejected as more machinery than this instance
warrants, which is a judgement that should be revisited if a second package ends up in
the same position.
