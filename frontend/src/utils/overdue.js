/**
 * What "overdue" means, once (ADR-0089).
 *
 * There were three answers. The backend has always used
 * `due_date < now AND status NOT IN (done, failed)` — consistently, at all six
 * of its call sites. The frontend counters used `status !== 'done'`, so a failed
 * task counted as overdue; on the seed database that made the dashboard say 91
 * while the analytics page, reading the same tasks, said 81. And the "Overdue"
 * *filter* in `taskFilters.js` checked no status at all, so it listed finished
 * work whose due date had passed.
 *
 * The backend's rule is the one kept: a failed task is not late, it is failed —
 * a different problem, with a different fix, already counted under "failed".
 */

const NOT_OVERDUE_STATUSES = new Set(['done', 'failed'])

export function isOverdue(task, now = new Date()) {
  if (!task?.due_date) return false
  if (NOT_OVERDUE_STATUSES.has(task.status)) return false
  return new Date(task.due_date) < now
}

export function countOverdue(tasks = [], now = new Date()) {
  return tasks.reduce((n, task) => (isOverdue(task, now) ? n + 1 : n), 0)
}

/** Due within `days` and still open — "due soon", the other side of the same line. */
export function isDueWithin(task, days, now = new Date()) {
  if (!task?.due_date) return false
  if (NOT_OVERDUE_STATUSES.has(task.status)) return false
  const limit = new Date(now)
  limit.setDate(limit.getDate() + days)
  return new Date(task.due_date) <= limit
}
