import { describe, expect, it } from 'vitest'
import { actionGroup, buildActivitySignals, bucketActivitySignals, signalStyle, summarizeActivitySignals } from '../activitySignals'

const entries = [
  { id: '1', action: 'task.created', detail: 'Task one', project_id: 'p1', created_at: '2026-06-27T10:00:00Z' },
  { id: '2', action: 'project.created', detail: 'Project one', project_id: 'p1', created_at: '2026-06-27T11:00:00Z' },
  { id: '3', action: 'decision.created', detail: 'Decision one', created_at: '2026-06-27T12:00:00Z' },
]

describe('activitySignals', () => {
  it('extracts action groups safely', () => {
    expect(actionGroup({ action: 'task.created' })).toBe('task')
    expect(actionGroup({})).toBe('other')
  })

  it('maps known and unknown groups to marker styles', () => {
    expect(signalStyle('task')).toMatchObject({ marker: 'task', color: '#facc15' })
    expect(signalStyle('decision')).toMatchObject({ marker: 'decision' })
    expect(signalStyle('unknown')).toMatchObject({ marker: 'other' })
  })

  it('builds positioned signals with project names', () => {
    const signals = buildActivitySignals(entries, { p1: 'Alpha' })
    expect(signals[0]).toMatchObject({ group: 'task', marker: 'task', projectName: 'Alpha', position: 0 })
    expect(signals[2].position).toBe(100)
  })

  it('summarizes by group count', () => {
    const summary = summarizeActivitySignals(buildActivitySignals(entries, {}))
    expect(summary.map(item => item.group)).toEqual(['decision', 'project', 'task'])
    expect(summary.every(item => item.count === 1)).toBe(true)
  })

  it('buckets signals for density display', () => {
    const buckets = bucketActivitySignals(buildActivitySignals(entries, {}), 4)
    expect(buckets).toHaveLength(4)
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
  })
})
