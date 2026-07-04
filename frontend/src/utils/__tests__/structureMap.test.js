import { describe, expect, it } from 'vitest'
import { dependencyNeighborhood, deriveStructureMap, taskRisk } from '../structureMap'

const now = new Date('2026-06-28T12:00:00Z')

const projects = [
  {
    id: 'p1',
    name: 'Launch Console',
    status: 'active',
    progress: 55,
    identities: [{ id: 'i1', name: 'Ops' }],
    tasks: [
      { id: 't1', title: 'Fix incident path', status: 'failed', priority: 'high' },
      { id: 't2', title: 'Ship banner', status: 'todo', priority: 'medium', due_date: '2026-06-27T12:00:00Z', blocked_by: ['t1'] },
      { id: 't3', title: 'Normal backlog', status: 'todo', priority: 'low' },
      { id: 't4', title: 'Child task', status: 'in_progress', priority: 'medium', parent_id: 't3' },
    ],
  },
  {
    id: 'p2',
    name: 'Unowned Project',
    status: 'active',
    identities: [],
    tasks: [{ id: 't5', title: 'Active task', status: 'in_progress', priority: 'medium' }],
  },
]

const identities = [
  { id: 'i1', name: 'Ops', avatar: 'O', color: '#facc15' },
  { id: 'i2', name: 'Unlinked', color: '#737373' },
]

const goals = [
  { id: 'g1', title: 'Reduce risk', status: 'active', progress: 20, projects: [{ project_id: 'p1' }] },
]

const decisions = [
  { id: 'd1', name: 'Choose graph model', decision_status: 'proposed', project_id: 'p1' },
]

describe('structureMap', () => {
  it('classifies task risk in priority order', () => {
    expect(taskRisk({ status: 'failed', due_date: '2026-06-27T12:00:00Z' }, now)).toBe('failed')
    expect(taskRisk({ status: 'todo', due_date: '2026-06-27T12:00:00Z' }, now)).toBe('overdue')
    expect(taskRisk({ status: 'todo', priority: 'high' }, now)).toBe('priority')
    expect(taskRisk({ status: 'in_progress' }, now)).toBe('active')
    expect(taskRisk({ status: 'todo' }, now)).toBe('normal')
  })

  it('derives graph nodes, stats, and cross-module links', () => {
    const graph = deriveStructureMap(projects, identities, goals, decisions, now)

    expect(graph.identityNodes.map(node => node.id)).toEqual(['i1', 'i2'])
    expect(graph.identityNodes.find(node => node.id === 'i1')).toMatchObject({
      projectIds: ['p1'],
      projectCount: 1,
    })
    expect(graph.projectNodes.find(node => node.id === 'p1')).toMatchObject({
      failed: 1,
      overdue: 1,
      dependencyCount: 1,
      pendingDecisionCount: 1,
      identityIds: ['i1'],
      risk: 'failed',
    })
    expect(graph.taskNodes.map(node => node.id)).toEqual(['t1', 't2', 't5'])
    expect(graph.stats).toMatchObject({
      identities: 2,
      projects: 2,
      tasks: 3,
      goals: 1,
      decisions: 1,
      failedProjects: 1,
      overdueProjects: 1,
      unownedProjects: 1,
      dependencies: 1,
    })
    expect(graph.dependencyTaskNodes.find(node => node.id === 't1')).toMatchObject({ blocking: ['t2'] })
    expect(graph.dependencyTaskNodes.find(node => node.id === 't2')).toMatchObject({ blockedBy: ['t1'] })
    expect(graph.dependencyLinks).toEqual(expect.arrayContaining([
      { from: 'task:t1', to: 'task:t2', type: 'dependency', projectId: 'p1' },
    ]))
    expect(graph.links).toEqual(expect.arrayContaining([
      { from: 'identity:i1', to: 'project:p1', type: 'owns' },
      { from: 'project:p1', to: 'task:t1', type: 'failed' },
      { from: 'goal:g1', to: 'project:p1', type: 'goal' },
      { from: 'decision:d1', to: 'project:p1', type: 'proposed' },
    ]))
  })

  it('collects a selected task dependency neighborhood in both directions', () => {
    const links = [
      { from: 'task:a', to: 'task:b', type: 'dependency' },
      { from: 'task:b', to: 'task:c', type: 'dependency' },
      { from: 'task:d', to: 'task:b', type: 'dependency' },
      { from: 'task:x', to: 'task:y', type: 'dependency' },
    ]

    expect(dependencyNeighborhood('b', links).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('limits dependency neighborhood traversal', () => {
    const links = [
      { from: 'task:a', to: 'task:b', type: 'dependency' },
      { from: 'task:b', to: 'task:c', type: 'dependency' },
      { from: 'task:c', to: 'task:d', type: 'dependency' },
    ]

    expect(dependencyNeighborhood('a', links, 2)).toHaveLength(2)
  })
})
