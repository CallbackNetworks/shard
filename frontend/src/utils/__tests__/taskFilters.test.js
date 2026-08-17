import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { filterTasks } from '../taskFilters'

const tasks = [
  { id: '1', status: 'todo', priority: 'high', assignee: 'ann', assigned_agent_name: 'bot', labels: [{ id: 'l1' }], due_date: null },
  { id: '2', status: 'done', priority: 'low', assignee: 'ben', assigned_agent_name: null, labels: [{ id: 'l2' }], due_date: '2020-01-01T00:00:00Z' },
  { id: '3', status: 'in_progress', priority: 'high', assignee: 'ann', assigned_agent_name: 'bot', labels: [], due_date: '2999-01-01T00:00:00Z' },
  // Past due and still open — the only kind of task "overdue" means (ADR-0089).
  { id: '4', status: 'todo', priority: 'low', assignee: 'ben', assigned_agent_name: null, labels: [], due_date: '2020-01-01T00:00:00Z' },
  { id: '5', status: 'failed', priority: 'low', assignee: 'ben', assigned_agent_name: null, labels: [], due_date: '2020-01-01T00:00:00Z' },
]

const ids = (list) => list.map(t => t.id)

describe('filterTasks', () => {
  it('returns the list unchanged when every dimension is "all"', () => {
    expect(filterTasks(tasks, {})).toBe(tasks)
    expect(ids(filterTasks(tasks, { status: 'all', priority: 'all' }))).toEqual(['1', '2', '3', '4', '5'])
  })

  it('filters by status, priority, assignee, and agent', () => {
    expect(ids(filterTasks(tasks, { status: 'todo' }))).toEqual(['1', '4'])
    expect(ids(filterTasks(tasks, { priority: 'high' }))).toEqual(['1', '3'])
    expect(ids(filterTasks(tasks, { assignee: 'ann' }))).toEqual(['1', '3'])
    expect(ids(filterTasks(tasks, { agent: 'bot' }))).toEqual(['1', '3'])
  })

  it('matches a label by id against the task label list', () => {
    expect(ids(filterTasks(tasks, { label: 'l1' }))).toEqual(['1'])
    expect(ids(filterTasks(tasks, { label: 'missing' }))).toEqual([])
  })

  it('combines multiple dimensions (AND semantics)', () => {
    expect(ids(filterTasks(tasks, { priority: 'high', assignee: 'ann', status: 'in_progress' }))).toEqual(['3'])
  })

  describe('due keyword', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-06-15T00:00:00Z'))
    })
    afterEach(() => vi.useRealTimers())

    // The filter used to check the date alone, so it listed '2' (done) and '5'
    // (failed) as overdue — a different answer from every overdue *count* in the
    // app, and from the backend (ADR-0089).
    it('overdue keeps past-due tasks that are still open', () => {
      expect(ids(filterTasks(tasks, { due: 'overdue' }))).toEqual(['4'])
    })

    it('no_date keeps only tasks without a due date', () => {
      expect(ids(filterTasks(tasks, { due: 'no_date' }))).toEqual(['1'])
    })

    it('this_week keeps tasks due within the next 7 days', () => {
      const soon = [{ id: 's', due_date: '2025-06-18T00:00:00Z' }]
      expect(ids(filterTasks(soon, { due: 'this_week' }))).toEqual(['s'])
      expect(ids(filterTasks(tasks, { due: 'this_week' }))).toEqual([])
    })
  })
})
