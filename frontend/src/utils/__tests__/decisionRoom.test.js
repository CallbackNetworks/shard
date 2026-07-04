import { describe, expect, it } from 'vitest'
import { decisionStatus, deriveDecisionRoom, groupDecisionsByProject } from '../decisionRoom'

const decisions = [
  { id: 'p', name: 'Pending', decision_status: 'proposed', project_id: 'a' },
  { id: 'a', name: 'Accepted', decision_status: 'accepted', project_id: 'a' },
  { id: 's', name: 'Superseded', decision_status: 'superseded', project_id: 'b' },
  { id: 'd', name: 'Deprecated', decision_status: 'deprecated', project_id: 'b' },
  { id: 'x', name: 'Implicit proposed', project_id: 'c' },
]

describe('decisionRoom derivation', () => {
  it('defaults missing status to proposed', () => {
    expect(decisionStatus({})).toBe('proposed')
  })

  it('splits pending queue from outcomes', () => {
    const room = deriveDecisionRoom(decisions)
    expect(room.queue.map(d => d.id)).toEqual(['p', 'x'])
    expect(room.outcomes.map(d => d.id)).toEqual(['a', 's', 'd'])
    expect(room.counts.proposed).toBe(2)
    expect(room.counts.accepted).toBe(1)
  })

  it('groups decisions by project', () => {
    const grouped = groupDecisionsByProject(decisions)
    expect(grouped.a.map(d => d.id)).toEqual(['p', 'a'])
    expect(grouped.b.map(d => d.id)).toEqual(['s', 'd'])
  })
})
