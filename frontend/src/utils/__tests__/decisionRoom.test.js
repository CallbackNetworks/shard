import { describe, expect, it } from 'vitest'
import { buildDecisionLineages, decisionStatus, deriveDecisionRoom, groupDecisionsByProject } from '../decisionRoom'

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

describe('buildDecisionLineages', () => {
  const ref = (d) => ({ id: d.id, type: 'decision', title: d.name })

  const v3 = { id: 'v3', name: 'Third', decision_status: 'accepted' }
  const v2 = { id: 'v2', name: 'Second', decision_status: 'superseded' }
  const v1 = { id: 'v1', name: 'First', decision_status: 'superseded' }
  const lone = { id: 'lone', name: 'Alone', decision_status: 'accepted' }
  const chain = [
    { ...v3, supersedes: [ref(v2)] },
    { ...v2, supersedes: [ref(v1)], superseded_by: [ref(v3)] },
    { ...v1, superseded_by: [ref(v2)] },
    lone,
  ]

  it('heads a lineage with the current decision and walks back through what it replaced', () => {
    const lineages = buildDecisionLineages(chain)
    expect(lineages.map(l => l.id)).toEqual(['v3', 'lone'])
    expect(lineages[0].chain.map(r => [r.decision.id, r.depth])).toEqual([
      ['v3', 0], ['v2', 1], ['v1', 2],
    ])
  })

  it('gives a decision with no relations a lineage of one', () => {
    const lineages = buildDecisionLineages(chain)
    expect(lineages[1].chain).toEqual([{ decision: lone, depth: 0 }])
  })

  it('promotes a child to a head when its replacement is filtered out', () => {
    // Same rule as the structure map and the board (ADR-0069, ADR-0094): resolution
    // happens within the visible set, so filtering never makes a record disappear.
    const lineages = buildDecisionLineages(chain.filter(d => d.id !== 'v3'))
    expect(lineages.map(l => l.id)).toEqual(['v2', 'lone'])
    expect(lineages[0].chain.map(r => r.decision.id)).toEqual(['v2', 'v1'])
  })

  it('still shows a record caught in a supersession cycle', () => {
    const a = { id: 'a', name: 'A' }
    const b = { id: 'b', name: 'B' }
    const cyclic = [
      { ...a, supersedes: [ref(b)], superseded_by: [ref(b)] },
      { ...b, supersedes: [ref(a)], superseded_by: [ref(a)] },
    ]
    const ids = buildDecisionLineages(cyclic).flatMap(l => l.chain.map(r => r.decision.id))
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  it('counts how many decisions govern work', () => {
    const room = deriveDecisionRoom([
      { id: 'g', decision_status: 'accepted', governs: [{ id: 't1', type: 'task', title: 'T' }] },
      { id: 'n', decision_status: 'accepted' },
    ])
    expect(room.counts.governing).toBe(1)
  })
})
