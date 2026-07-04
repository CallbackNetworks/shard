import { describe, expect, it } from 'vitest'
import { classifyCommandTask, deriveCommandCenter, flattenProjectTasks, isOverdue } from '../commandCenter'

const NOW = new Date('2026-06-27T12:00:00Z')

function project(tasks = []) {
  return {
    id: 'p1',
    name: 'Alpha',
    status: 'active',
    tasks,
  }
}

describe('commandCenter derivation', () => {
  it('handles empty inputs', () => {
    const result = deriveCommandCenter([], [], [], [], NOW)
    expect(result.metrics.activeTasks).toBe(0)
    expect(result.metrics.completion).toBe(0)
    expect(result.lanes.critical).toEqual([])
    expect(result.metrics.latestSignal).toBe('SYSTEM READY')
  })

  it('flattens project tasks with project metadata', () => {
    const tasks = flattenProjectTasks([project([{ id: 't1', title: 'Ship' }])])
    expect(tasks[0]).toMatchObject({ id: 't1', projectId: 'p1', projectName: 'Alpha' })
  })

  it('ignores invalid and missing due dates for overdue checks', () => {
    expect(isOverdue({ status: 'todo', due_date: 'not-a-date' }, NOW)).toBe(false)
    expect(isOverdue({ status: 'todo' }, NOW)).toBe(false)
  })

  it('classifies failed, overdue, and high priority tasks as critical', () => {
    expect(classifyCommandTask({ status: 'failed' }, NOW)).toBe('critical')
    expect(classifyCommandTask({ status: 'todo', due_date: '2026-06-26T12:00:00Z' }, NOW)).toBe('critical')
    expect(classifyCommandTask({ status: 'todo', priority: 'high' }, NOW)).toBe('critical')
  })

  it('places unknown active-like statuses into waiting', () => {
    const result = deriveCommandCenter([
      project([{ id: 't1', title: 'Review', status: 'queued' }]),
    ], [], [], [], NOW)
    expect(result.lanes.waiting.map(t => t.id)).toEqual(['t1'])
  })

  it('computes completion and lane counts', () => {
    const result = deriveCommandCenter([
      project([
        { id: 'done', title: 'Done', status: 'done' },
        { id: 'active', title: 'Active', status: 'in_progress' },
        { id: 'late', title: 'Late', status: 'todo', due_date: '2026-06-20T12:00:00Z' },
        { id: 'failed', title: 'Failed', status: 'failed' },
      ]),
    ], [{ action: 'task.created', detail: 'Latest task' }], [], [], NOW)

    expect(result.metrics.completion).toBe(25)
    expect(result.metrics.activeTasks).toBe(2)
    expect(result.metrics.failed).toBe(1)
    expect(result.lanes.critical.map(t => t.id)).toEqual(['late', 'failed'])
    expect(result.lanes.inMotion.map(t => t.id)).toEqual(['active'])
    expect(result.metrics.latestSignal).toBe('Latest task')
  })
})
