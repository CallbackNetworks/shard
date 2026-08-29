import { describe, expect, it } from 'vitest'
import {
  buildDecisionGroups, buildDecisionLineages, decisionMatches, decisionStatus,
  deriveDecisionRoom, groupDecisionsByProject, soloLineages, splitLineages,
} from '../decisionRoom'

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
    expect(lineages[1].chain).toEqual([{ decision: lone, depth: 0, parentId: null }])
  })

  it('names the decision each row was replaced by, so the rail can withdraw the edge', () => {
    // The rail *is* the supersession edge; without the parent it would be a picture of
    // a relation with no way to act on it, and the withdraw control had to stay on a
    // chip the rail already made redundant.
    const [head] = buildDecisionLineages(chain)
    expect(head.chain.map(r => [r.decision.id, r.parentId])).toEqual([
      ['v3', null], ['v2', 'v3'], ['v1', 'v2'],
    ])
    expect([...head.chainIds]).toEqual(['v3', 'v2', 'v1'])
  })

  it('keeps chains apart from single records', () => {
    // Production holds 103 decisions and one supersession edge. A "lineage" section
    // listing both is a list of 102 identical cards in which the one chain is invisible.
    const { chains, singles } = splitLineages(buildDecisionLineages(chain))
    expect(chains.map(l => l.id)).toEqual(['v3'])
    expect(singles.map(l => l.id)).toEqual(['lone'])
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

describe('buildDecisionGroups', () => {
  const ref = (id, type, title) => ({ id, type, type_label: type, title })
  const org = ref('org', 'organization', 'CallbackNetwork')
  const shard = ref('shard', 'project', 'Shard')
  const n8n = ref('n8n', 'project', 'n8n')
  const solo = ref('solo', 'project', 'Callback Relay')

  const d = (id) => ({ id, name: id, decision_status: 'accepted' })
  const lineages = soloLineages([d('a'), d('b'), d('c'), d('d')])
  const ancestry = {
    a: { trails: [[org, shard]] },
    b: { trails: [[org, shard]] },
    c: { trails: [[org, n8n]] },
    d: { trails: [[solo]] },
  }

  it('folds shared trails into one parent row', () => {
    // The point of the trie: an organization holding two projects is one row and not
    // two, which is the difference between reading a hierarchy and reading a list of
    // repeated breadcrumbs.
    const { groups } = buildDecisionGroups(lineages, ancestry)
    expect(groups.map(g => g.ref.id)).toEqual(['org', 'solo'])
    const orgGroup = groups[0]
    expect(orgGroup.total).toBe(3)
    expect(orgGroup.children.map(g => g.ref.id)).toEqual(['shard', 'n8n'])
    expect(orgGroup.children[0].total).toBe(2)
    // Records live at the level that contains them, not at the level above it.
    expect(orgGroup.lineages).toEqual([])
  })

  it('counts records, not lineages', () => {
    // A group header saying "1" above a chain of three is the disagreement between a
    // count and the rows under it that ADR-0068 exists to prevent.
    const chain = [{
      id: 'v3',
      head: d('v3'),
      chain: [{ decision: d('v3'), depth: 0 }, { decision: d('v2'), depth: 1 }, { decision: d('v1'), depth: 2 }],
      chainIds: new Set(['v3', 'v2', 'v1']),
    }]
    const { groups, total } = buildDecisionGroups(chain, { v3: { trails: [[shard]] } })
    expect(groups[0].total).toBe(3)
    expect(total).toBe(3)
  })

  it('keeps a decision nothing contains rather than inventing a parent', () => {
    const { groups, loose } = buildDecisionGroups(soloLineages([d('orphan')]), {})
    expect(groups).toEqual([])
    expect(loose.map(l => l.head.id)).toEqual(['orphan'])
  })

  it('files a chain under the group of its head', () => {
    // Supersession candidates are restricted to one project, so a chain never spans
    // two groups — but it must not be split across them either.
    const chain = [{
      id: 'new',
      head: d('new'),
      chain: [{ decision: d('new'), depth: 0 }, { decision: d('old'), depth: 1 }],
      chainIds: new Set(['new', 'old']),
    }]
    const { groups } = buildDecisionGroups(chain, { new: { trails: [[org, shard]] }, old: { trails: [[solo]] } })
    expect(groups).toHaveLength(1)
    expect(groups[0].children[0].lineages).toHaveLength(1)
  })

  it('orders groups by how much they hold', () => {
    const { groups } = buildDecisionGroups(lineages, ancestry)
    expect(groups.map(g => g.total)).toEqual([3, 1])
  })
})

describe('decisionMatches', () => {
  const decision = { name: 'ADR-0118: a decision is a node type', description: 'supersedes and governs' }

  it('matches an empty query', () => {
    expect(decisionMatches(decision, '   ')).toBe(true)
  })

  it('reaches the ADR number in the title', () => {
    expect(decisionMatches(decision, '0118')).toBe(true)
  })

  it('reaches the body and the project name', () => {
    expect(decisionMatches(decision, 'governs')).toBe(true)
    expect(decisionMatches(decision, 'shard', 'Shard')).toBe(true)
    expect(decisionMatches(decision, 'nothing here')).toBe(false)
  })
})
