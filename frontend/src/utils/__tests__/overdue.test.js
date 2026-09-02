import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isOverdue, countOverdue, isDueWithin } from '../overdue'

const NOW = new Date('2026-08-16T12:00:00Z')
const past = { due_date: '2026-08-01T00:00:00Z' }
const future = { due_date: '2026-09-01T00:00:00Z' }

describe('what "overdue" means', () => {
  it('is past its due date and still open', () => {
    expect(isOverdue({ ...past, status: 'todo' }, NOW)).toBe(true)
    expect(isOverdue({ ...past, status: 'in_progress' }, NOW)).toBe(true)
  })

  it('is not a finished task', () => {
    expect(isOverdue({ ...past, status: 'done' }, NOW)).toBe(false)
  })

  // The whole point of ADR-0089: the frontend counted these and the backend did
  // not, so the dashboard and the analytics page reported different numbers for
  // the same word. A failed task is not late.
  it('is not a failed task', () => {
    expect(isOverdue({ ...past, status: 'failed' }, NOW)).toBe(false)
  })

  // The backend's SQL form of this rule disagreed here and nowhere else: `status
  // NOT IN ('done','failed')` is NULL for a NULL status, so every unset-status row
  // was dropped by the query while this function kept it (ADR-0142). `status` is a
  // nullable column with no default, so an unset one is a real row, not a theory.
  it('is a task whose status was never set — unset is open, not closed', () => {
    expect(isOverdue({ ...past, status: null }, NOW)).toBe(true)
    expect(isOverdue({ ...past }, NOW)).toBe(true)
  })

  it('is not a task with no due date, or one still ahead', () => {
    expect(isOverdue({ status: 'todo' }, NOW)).toBe(false)
    expect(isOverdue({ ...future, status: 'todo' }, NOW)).toBe(false)
  })

  it('survives a missing task', () => {
    expect(isOverdue(null, NOW)).toBe(false)
    expect(isOverdue(undefined, NOW)).toBe(false)
  })

  it('counts a list by the same rule', () => {
    const tasks = [
      { ...past, status: 'todo' },
      { ...past, status: 'in_progress' },
      { ...past, status: 'failed' },
      { ...past, status: 'done' },
      { ...future, status: 'todo' },
    ]
    expect(countOverdue(tasks, NOW)).toBe(2)
  })
})

describe('"due soon" closes over the same statuses', () => {
  it('includes an open task inside the window and excludes closed ones', () => {
    expect(isDueWithin({ due_date: '2026-08-20T00:00:00Z', status: 'todo' }, 7, NOW)).toBe(true)
    expect(isDueWithin({ due_date: '2026-08-20T00:00:00Z', status: 'failed' }, 7, NOW)).toBe(false)
    expect(isDueWithin({ due_date: '2026-09-30T00:00:00Z', status: 'todo' }, 7, NOW)).toBe(false)
  })
})

/**
 * The rule was restated inline in eleven components plus a fourth, separate
 * `isOverdue` in `commandCenter.js`. Copies are how the two ends drifted, so a
 * new copy fails here rather than quietly producing a twelfth number.
 */
describe('nothing restates the rule', () => {
  const SRC = resolve(__dirname, '../..')
  const walk = (dir) => readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full)
    return /\.jsx?$/.test(full) ? [full] : []
  })

  // `due_date` mentioned in the same expression as a status comparison.
  const HAND_ROLLED = /due_date[^\n]{0,120}status\s*!==|status\s*!==[^\n]{0,120}due_date/

  it.each(
    walk(SRC)
      .map(f => relative(SRC, f).replaceAll('\\', '/'))
      .filter(rel => rel !== 'utils/overdue.js')
  )('%s does not hand-roll an overdue check', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf8')
    expect(
      HAND_ROLLED.test(source),
      `${rel} compares a due date against a status itself — import isOverdue from utils/overdue`,
    ).toBe(false)
  })
})
