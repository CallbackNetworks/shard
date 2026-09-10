import { describe, it, expect } from 'vitest'
import { buildShareSlice, SHARE_EDGE_TYPES, SHARE_NODE_TYPES } from '../shareGraph'
import { deriveGraphStructure } from '../graphStructure'

const projectPayload = () => ({
  meta: { scope: 'project' },
  identity: { id: 'p1', name: 'Payment Gateway v2' },
  projects: [
    {
      id: 'p1',
      name: 'Payment Gateway v2',
      status: 'active',
      tasks: [
        {
          id: 't1', title: 'Stripe flow', status: 'in_progress', priority: 'high',
          subtasks: [{ id: 't1a', title: 'Read the spec', status: 'done', priority: 'low' }],
          blocked_by: [], blocking: [{ id: 't2', title: 'Webhooks' }],
        },
        {
          id: 't2', title: 'Webhooks', status: 'todo', priority: 'high',
          subtasks: [], blocked_by: [{ id: 't1', title: 'Stripe flow' }], blocking: [],
        },
      ],
      decisions: [
        {
          id: 'd1', name: 'ADR-002', decision_status: 'accepted',
          supersedes: [{ id: 'd2', title: 'ADR-001' }], superseded_by: [], governs: [{ id: 't1', title: 'Stripe flow' }],
        },
        { id: 'd2', name: 'ADR-001', decision_status: 'superseded', supersedes: [], superseded_by: [{ id: 'd1', title: 'ADR-002' }], governs: [] },
      ],
    },
  ],
})

const relTypes = (slice, rel) => slice.edges.filter(e => e.rel_type === rel)

describe('buildShareSlice', () => {
  it('turns every relation the payload carries into an edge', () => {
    const slice = buildShareSlice(projectPayload())

    expect(slice.nodes.map(n => n.id).sort()).toEqual(['d1', 'd2', 'p1', 't1', 't1a', 't2'])
    // project -> task, task -> subtask, project -> decision
    expect(relTypes(slice, 'contains')).toHaveLength(5)
    // The dependency is stated twice in the payload (blocked_by on one end, blocking on
    // the other); drawing it twice would double every arc on the map.
    expect(relTypes(slice, 'depends_on')).toEqual([
      expect.objectContaining({ source_id: 't2', target_id: 't1' }),
    ])
    // Same for supersession, which each end reports from its own side.
    expect(relTypes(slice, 'supersedes')).toEqual([
      expect.objectContaining({ source_id: 'd1', target_id: 'd2' }),
    ])
    expect(relTypes(slice, 'governs')).toEqual([
      expect.objectContaining({ source_id: 'd1', target_id: 't1' }),
    ])
  })

  it('does not draw the shared project a second time as its own owner', () => {
    // For a project or container share the payload's `identity` block is the shared
    // node restated as a page header, and it carries the *project's* id.
    const slice = buildShareSlice(projectPayload())
    expect(slice.nodes.filter(n => n.type === 'identity')).toHaveLength(0)
    expect(relTypes(slice, 'owns')).toHaveLength(0)
  })

  it('gives an identity share its owner and an owns edge per project', () => {
    const slice = buildShareSlice({
      meta: { scope: 'identity' },
      identity: { id: 'i1', name: 'ChungChen', color: '#facc15' },
      projects: [
        { id: 'p1', name: 'One', status: 'active', tasks: [], decisions: [] },
        { id: 'p2', name: 'Two', status: 'active', tasks: [], decisions: [] },
      ],
    })
    expect(slice.nodes.filter(n => n.type === 'identity').map(n => n.id)).toEqual(['i1'])
    expect(relTypes(slice, 'owns').map(e => e.target_id)).toEqual(['p1', 'p2'])
  })

  it('drops an edge whose far end was not shared', () => {
    const slice = buildShareSlice({
      meta: { scope: 'project' },
      identity: { id: 'p1' },
      projects: [{
        id: 'p1', name: 'One', status: 'active', decisions: [],
        tasks: [{ id: 't1', title: 'A', status: 'todo', blocked_by: [{ id: 'gone', title: 'Elsewhere' }] }],
      }],
    })
    expect(relTypes(slice, 'depends_on')).toHaveLength(0)
  })

  it('leaves out a project the payload marks inactive', () => {
    const slice = buildShareSlice({
      meta: { scope: 'identity' },
      identity: { id: 'i1', name: 'X' },
      projects: [{ id: 'p1', name: 'Archived', status: 'archived', tasks: [], decisions: [] }],
    })
    expect(slice.nodes.map(n => n.id)).toEqual(['i1'])
  })
})

describe('the slice feeds the structure map derivation unchanged', () => {
  it('derives the same shape /structure derives from /graph/map', () => {
    const graph = deriveGraphStructure(buildShareSlice(projectPayload()), SHARE_NODE_TYPES, SHARE_EDGE_TYPES)

    expect(graph.projectNodes.map(p => p.name)).toEqual(['Payment Gateway v2'])
    // A subtask stays inside its parent's row, which is also the ADR-0068 size rule.
    expect(graph.allTaskNodes.map(t => t.id).sort()).toEqual(['t1', 't2'])
    expect(graph.projectNodes[0].totalTasks).toBe(2)
    expect(graph.dependencyLinks).toEqual([
      expect.objectContaining({ from: 'task:t1', to: 'task:t2' }),
    ])
    // A decision's state reaches the map from the column, so a settled record is not
    // reported as `proposed` (the read this pass fixed).
    expect(graph.decisionNodes.map(d => d.status).sort()).toEqual(['accepted', 'superseded'])
    expect(graph.projectNodes[0].pendingDecisionCount).toBe(0)
    // `governs` and `supersedes` are relations the map draws itself, not containment.
    expect(graph.customLinks.map(l => l.relType).sort()).toEqual(['governs', 'supersedes'])
  })
})
