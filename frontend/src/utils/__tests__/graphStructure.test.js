import { describe, it, expect } from 'vitest'
import { deriveGraphStructure, focusGraph } from '../graphStructure'

const nodeTypes = [
  // roles is the canonical capability surface (ADR-0040); NodeTypeOut no longer
  // ships is_container/is_task_like booleans, so fixtures must use roles too.
  { key: 'project', label: 'Project', is_builtin: true, roles: ['container', 'shareable', 'subscribable'] },
  { key: 'task', label: 'Task', is_builtin: true, roles: ['task'] },
  { key: 'identity', label: 'Identity', is_builtin: true, roles: ['shareable', 'subscribable'] },
  { key: 'goal', label: 'Goal', is_builtin: true, roles: [] },
  { key: 'label', label: 'Label', is_builtin: true, roles: [] },
  { key: 'topic', label: 'Topic', is_builtin: false, roles: ['container'], color: '#f59e0b' },
  { key: 'ticket', label: 'Ticket', is_builtin: false, roles: ['task'], color: '#22d3ee' },
  { key: 'note', label: 'Note', is_builtin: false, roles: [], color: '#a3e635' },
]
const edgeTypes = [
  { key: 'contains', label: 'Contains', is_builtin: true, is_containment: true },
  { key: 'member_of', label: 'Member of', is_builtin: true, is_containment: false },
  { key: 'part_of', label: 'Part of', is_builtin: true, is_containment: false },
  { key: 'depends_on', label: 'Depends on', is_builtin: true, is_containment: false },
  { key: 'labeled', label: 'Labeled', is_builtin: true, is_containment: false },
  { key: 'references', label: 'References', is_builtin: false, is_containment: false },
]

function fixture() {
  const nodes = [
    { id: 'i1', type: 'identity', title: 'Me', data: { color: '#abc', avatar: 'M', share_token: 'tok' } },
    { id: 'p1', type: 'project', title: 'Shard', status: 'active', data: {} },
    { id: 'c1', type: 'topic', title: 'Research', status: null, data: {} },
    { id: 't1', type: 'task', title: 'Build map', status: 'in_progress', priority: 'high', data: { assignee: 'me' } },
    { id: 't2', type: 'task', title: 'Old chore', status: 'done', priority: 'medium', data: {} },
    { id: 't3', type: 'task', title: 'Subtask', status: 'todo', priority: 'medium', data: {} },
    { id: 'k1', type: 'ticket', title: 'Custom ticket', status: 'todo', priority: 'high', data: {} },
    { id: 'g1', type: 'goal', title: 'Ship it', status: 'active', data: {} },
    { id: 'd1', type: 'label', title: 'Use graph', data: { type: 'decision', decision_status: 'proposed' } },
    { id: 'l1', type: 'label', title: 'bug', data: { type: 'label' } },
    { id: 'n1', type: 'note', title: 'Design note', data: {} },
  ]
  const edges = [
    { id: 'e1', source_id: 'i1', target_id: 'p1', rel_type: 'member_of' },
    { id: 'e2', source_id: 'c1', target_id: 'p1', rel_type: 'contains' },
    { id: 'e3', source_id: 'p1', target_id: 't1', rel_type: 'contains' },
    { id: 'e4', source_id: 'p1', target_id: 't2', rel_type: 'contains' },
    { id: 'e5', source_id: 'p1', target_id: 't3', rel_type: 'contains' },
    { id: 'e6', source_id: 't1', target_id: 't3', rel_type: 'contains' },
    { id: 'e7', source_id: 'c1', target_id: 'k1', rel_type: 'contains' },
    { id: 'e8', source_id: 'p1', target_id: 'd1', rel_type: 'contains' },
    { id: 'e9', source_id: 'p1', target_id: 'l1', rel_type: 'contains' },
    { id: 'e10', source_id: 'p1', target_id: 'n1', rel_type: 'contains' },
    { id: 'e11', source_id: 'p1', target_id: 'g1', rel_type: 'part_of' },
    { id: 'e12', source_id: 't1', target_id: 't2', rel_type: 'depends_on' },
    { id: 'e13', source_id: 't1', target_id: 'n1', rel_type: 'references' },
  ]
  return { nodes, edges }
}

describe('deriveGraphStructure', () => {
  const graph = deriveGraphStructure(fixture(), nodeTypes, edgeTypes)

  it('treats every container-role node as a project card, with registry metadata', () => {
    const ids = graph.projectNodes.map(p => p.id).sort()
    expect(ids).toEqual(['c1', 'p1'])
    const topic = graph.projectNodes.find(p => p.id === 'c1')
    expect(topic.type).toBe('project') // map role stays 'project' for the renderers
    expect(topic.isCustomType).toBe(true)
    expect(topic.typeLabel).toBe('Topic')
    expect(topic.typeColor).toBe('#f59e0b')
  })

  it('computes container enrichment from the graph', () => {
    const p1 = graph.projectNodes.find(p => p.id === 'p1')
    expect(p1.totalTasks).toBe(3) // t1, t2, t3 (flat containment includes subtasks)
    expect(p1.doneTasks).toBe(1)
    expect(p1.progress).toBe(33)
    expect(p1.risk).toBe('active')
    expect(p1.identityIds).toEqual(['i1'])
    expect(p1.decisionCount).toBe(1)
    expect(p1.pendingDecisionCount).toBe(1)
    expect(p1.dependencyCount).toBe(1)
    expect(p1.parentContainerId).toBe('c1') // nested containers survive
  })

  it('includes custom task-like nodes as tasks and skips subtasks', () => {
    const taskIds = graph.taskNodes.map(t => t.id).sort()
    expect(taskIds).toEqual(['k1', 't1', 't2'])
    expect(taskIds).not.toContain('t3') // subtask of t1
    const ticket = graph.taskNodes.find(t => t.id === 'k1')
    expect(ticket.projectId).toBe('c1')
    expect(ticket.isCustomType).toBe(true)
    const t1 = graph.taskNodes.find(t => t.id === 't1')
    expect(t1.blockedBy).toEqual(['t2'])
    expect(t1.assignee).toBe('me')
  })

  it('derives decisions from decision-kind labels only', () => {
    expect(graph.decisionNodes.map(d => d.id)).toEqual(['d1'])
    expect(graph.decisionNodes[0].status).toBe('proposed')
    expect(graph.decisionNodes[0].projectId).toBe('p1')
  })

  it('derives identities, goals, and their links from edges', () => {
    const me = graph.identityNodes[0]
    expect(me.projectIds).toEqual(['p1'])
    expect(me.shareActive).toBe(true)
    const goal = graph.goalNodes[0]
    expect(goal.projectIds).toEqual(['p1'])
    expect(goal.progress).toBe(33) // mean of linked container progress
    expect(graph.links).toContainEqual({ from: 'identity:i1', to: 'project:p1', type: 'owns' })
    expect(graph.links).toContainEqual({ from: 'goal:g1', to: 'project:p1', type: 'goal' })
    expect(graph.links).toContainEqual({ from: 'project:c1', to: 'project:p1', type: 'contains' })
  })

  it('surfaces custom plain nodes and custom relation edges', () => {
    expect(graph.customNodes.map(n => n.id)).toEqual(['n1'])
    expect(graph.customNodes[0].parentProjectId).toBe('p1')
    expect(graph.customLinks).toEqual([
      { from: 'task:t1', to: 'custom:n1', relType: 'references', label: 'References' },
    ])
    expect(graph.links).toContainEqual({ from: 'project:p1', to: 'custom:n1', type: 'contains' })
    expect(graph.stats.customNodes).toBe(1)
  })

  it('builds dependency links among dependency tasks', () => {
    expect(graph.dependencyLinks).toEqual([
      { from: 'task:t2', to: 'task:t1', type: 'dependency', projectId: 'p1' },
    ])
  })
})

describe('focusGraph', () => {
  const graph = deriveGraphStructure(fixture(), nodeTypes, edgeTypes)

  it('returns the graph unchanged without a focus', () => {
    expect(focusGraph(graph, null)).toBe(graph)
  })

  it('narrows to the focused identity world', () => {
    const focused = focusGraph(graph, 'i1')
    expect(focused.projectNodes.map(p => p.id)).toEqual(['p1']) // c1 has no owner
    expect(focused.taskNodes.map(t => t.id).sort()).toEqual(['t1', 't2'])
    expect(focused.customNodes.map(n => n.id)).toEqual(['n1'])
    expect(focused.stats.projects).toBe(1)
    expect(focused.stats.unownedProjects).toBe(0)
    // Cross-boundary links disappear.
    expect(focused.links.every(l => !l.from.includes('c1') && !l.to.includes('c1'))).toBe(true)
  })
})
