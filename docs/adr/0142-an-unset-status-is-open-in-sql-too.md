# ADR-0142: An unset status is open in SQL too

## Status
Accepted

## Date
2026-09-02

## Context

[ADR-0089](0089-one-assistant-one-definition-of-overdue.md) settled what "overdue"
means — `due_date < now AND status NOT IN (done, failed)` — put it in
`graph.overdue_clause()` / `graph.is_overdue()` and `frontend/src/utils/overdue.js`,
and added `tests/test_overdue_agreement.py` to ask every reporting surface the same
question. That closed a real disagreement: the dashboard said 91 and the analytics page
said 81 about the same tasks.

The rule was stated three times, in three languages, and one of the three does not mean
what the other two mean.

`Node.status` is nullable and carries no column default. In SQL, `NULL NOT IN ('done',
'failed')` evaluates to NULL, not true, so `Node.status.notin_(CLOSED_STATUSES)` **drops
every unset-status row**. The Python form — `task.status in CLOSED_STATUSES` — reads
`None` as not-closed and keeps it, and so does the JavaScript, where
`Set.has(undefined)` is false. So a task with no status and a past due date was overdue
for `is_overdue`, overdue in the browser, and invisible to every query.

Production carries ten such tasks. None of them currently has a due date, so the numbers
on screen agree today; the divergence is latent rather than live, and would become live
the first time one of those ten is given a deadline.

Two things made it survive ADR-0089's guard. The test's six cases are `todo`,
`in_progress`, `failed`, `done` and two `todo` variants — every one of them answered
identically by a filter with this bug and a filter without it, so no number of
additional non-NULL cases would have found it. And three other queries had copied the
rule out as the literal `["done", "failed"]` rather than reading `CLOSED_STATUSES`,
which put them beyond the reach of a search for the constant:

- `critical_path.py` — the planning view's set of still-open tasks.
- `scheduler.py`, the due-date reminder sweep — so an unset-status task could never be
  reminded about. This is [ADR-0090](0090-a-task-like-type-is-a-task-everywhere.md)'s
  symptom exactly, arrived at through a different column.
- `scheduler.py`, the daily summary's "due today".

The duplication is the more interesting half. Each copy was correct about `done` and
`failed`; each independently carried the NULL behaviour; and none of them would look
wrong to a reader who was not thinking about three-valued logic.

## Decision

**An unset status is open, in all three languages.** `graph.open_status_clause()` is the
one SQL criterion for it — `status IS NULL OR status NOT IN (done, failed)` — and
`graph.is_closed(status)` is its Python counterpart, so the rule reads the same way
whether a query or a loaded object is at hand. `overdue_clause` is defined in terms of
the first; `is_overdue` and the public share page's count in terms of the second. The
frontend needs no change: it already behaved this way.

Open was chosen over closed because it is what the database means. NULL is not a state
somebody selected; it is the absence of one, and nobody has said this work is done or
has failed. It is also the reading two of the three implementations already had, so it
is the change that moves one site rather than three.

The three literal copies now call `open_status_clause()`, and a static scan in
`test_overdue_agreement.py` fails on any new `status.notin_(...)` outside the module
that owns the rule. It is a scan and not a behavioural assertion on purpose: the defect
is duplication, and a fifth copy written tomorrow would give the right answer on the day
it lands and drift later — which is what these three did.

`CASES` gains the row that distinguishes the two filters. That the file needed a
seventh case rather than a seventh surface is the lesson worth keeping: a guard test
that asks every surface the same question is only as good as the *inputs* it asks
about, and this one covered the surfaces exhaustively while covering the values by
example.

## Consequences

**Positive.** The rule now has one meaning at every value its column can hold, and the
scan makes a fifth copy a failing test rather than a future defect. Three queries that
silently ignored unset-status tasks — the critical path, the reminder sweep and the
daily summary — now include them, which also means such a task can be reminded about
for the first time.

**Positive.** `is_closed()` gives the Python side a name, so a reader no longer has to
notice that `None in [...]` being False is load-bearing.

**Negative.** This changes numbers. Any instance holding unset-status tasks with due
dates will see overdue counts rise and may get reminder emails about tasks that never
generated one before. That is the correct behaviour arriving late, but it will look
like a regression to whoever receives the first one.

**Negative.** The underlying oddity is untouched: `status` remains nullable with no
default, so NULL keeps arriving and every future status predicate has to think about
it. Backfilling the column and making it non-nullable is the fix that would remove the
class rather than this instance, and it is deliberately not done here — it is a
migration over live data in service of a case this decision has already made safe.

**Negative.** The scan matches on the text `status.notin_(`, so a copy written with
`~Node.status.in_(...)` or assembled through a variable passes it. It catches the shape
that actually occurred three times, not every shape that could.
