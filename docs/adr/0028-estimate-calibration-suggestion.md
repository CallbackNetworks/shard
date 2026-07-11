# ADR-0028: Estimate Calibration Suggestion

## Status
Accepted

## Date
2026-07-11

## Context
ADR-added estimation-calibration analytics (`/analytics/estimation-calibration`)
surface how a user's estimates compare to actual time spent — showing, for
example, that tasks are systematically finished at 1.4× their estimate. But that
insight lived only in a chart; nothing fed it back into the moment an estimate
is actually entered. The calibration loop was open: you could see your bias but
had to correct for it by hand every time.

## Decision
Add `GET /analytics/estimate-suggestion?raw_estimate=N` which turns the same
history into a concrete suggestion: `suggested = round(raw_estimate × ratio)`.

- The ratio is the spent/estimate ratio of completed tasks in the size bucket
  the raw estimate falls into (the existing `ESTIMATE_BUCKETS`), so a small task
  is calibrated against other small tasks.
- When that bucket is sparse (< 3 samples) the endpoint falls back to the
  overall median ratio; below 5 total completed-and-estimated tasks it returns
  no suggestion rather than guessing from noise.
- A project with too little history falls back to global history, reported via
  `basis_scope` so the UI can be honest about where the number came from.

The suggestion is offered in TaskEditForm next to the estimate field: a spark
button fetches it on demand (explicit, not on every keystroke), and the result
renders as a one-click chip that applies the suggested value. It is always a
suggestion — never auto-applied.

## Consequences
Positive:
- Closes the calibration loop: the bias the analytics already measured now
  nudges the estimate at entry time, in one click.
- Reuses the existing buckets and completed-task query; no new storage or model.
- Thresholds keep it quiet until there is enough personal history to be useful,
  and `basis`/`basis_scope`/`sample_size` make the basis transparent.

Negative:
- The model is deliberately simple (bucketed ratio), not a regression or
  per-label/per-assignee model. It corrects for systematic over/under-estimation
  by task size but not for other factors.
- It multiplies the user's own anchor, so it cannot help a first estimate for a
  wholly novel kind of work — only calibrate against past patterns.
- The suggestion is fetched on demand from the edit form rather than shown
  inline as you type, trading a little immediacy for far fewer requests.
