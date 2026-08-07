import { describe, expect, it } from 'vitest'
import { buildTerritoryModel, computeTerritoryHighlight } from '../territoryModel'

const identities = [
  { id: 'i1', type: 'identity', name: 'Ops', color: '#facc15' },
  { id: 'i2', type: 'identity', name: 'Dev', color: '#818cf8' },
]

const projects = [
  { id: 'p1', type: 'project', name: 'Solo Ops', risk: 'normal', identityIds: ['i1'] },
  { id: 'p2', type: 'project', name: 'Joint Venture', risk: 'failed', identityIds: ['i1', 'i2'] },
  { id: 'p3', type: 'project', name: 'Orphan', risk: 'overdue', identityIds: [] },
  { id: 'p4', type: 'project', name: 'Dev Only', risk: 'active', identityIds: ['i2'] },
]

const tasks = [
  { id: 't1', type: 'task', projectId: 'p1', name: 'Low task', risk: 'normal', blockedBy: [], blocking: [] },
  { id: 't2', type: 'task', projectId: 'p1', name: 'Hot task', risk: 'failed', blockedBy: [], blocking: [] },
  { id: 't3', type: 'task', projectId: 'p4', name: 'Dev task', risk: 'active', blockedBy: [], blocking: [] },
  { id: 't9', type: 'task', projectId: 'gone', name: 'Hidden', risk: 'normal', blockedBy: [], blocking: [] },
]

const goals = [
  { id: 'g1', type: 'goal', name: 'Ship it', progress: 40, projectIds: ['p1', 'p4', 'gone'] },
]

const decisions = [
  { id: 'd1', type: 'decision', name: 'Pick stack', status: 'proposed', projectId: 'p4' },
  { id: 'd2', type: 'decision', name: 'Old call', status: 'decided', projectId: 'gone' },
]

describe('buildTerritoryModel', () => {
  const model = buildTerritoryModel({ projects, identities, tasks, goals, decisions })

  it('groups projects into territories, shared, and unowned lanes', () => {
    expect(model.territories.map(entry => entry.identity.id)).toEqual(['i1', 'i2'])
    expect(model.territories[0].projects.map(project => project.id)).toEqual(['p1'])
    expect(model.territories[1].projects.map(project => project.id)).toEqual(['p4'])
    expect(model.shared.map(project => project.id)).toEqual(['p2'])
    expect(model.unowned.map(project => project.id)).toEqual(['p3'])
  })

  it('groups tasks per project ordered by weight and drops hidden projects', () => {
    expect(model.tasksByProject.get('p1').map(task => task.id)).toEqual(['t2', 't1'])
    expect(model.tasksByProject.has('gone')).toBe(false)
  })

  it('groups decisions per visible project', () => {
    expect(model.decisionsByProject.get('p4').map(decision => decision.id)).toEqual(['d1'])
    expect(model.decisionsByProject.has('gone')).toBe(false)
  })

  it('restricts goal links to visible projects', () => {
    expect(model.goals[0].linkedProjectIds).toEqual(['p1', 'p4'])
  })

  it('collects every renderable node key', () => {
    expect(model.keys.has('identity:i1')).toBe(true)
    expect(model.keys.has('project:p3')).toBe(true)
    expect(model.keys.has('task:t2')).toBe(true)
    expect(model.keys.has('decision:d1')).toBe(true)
    expect(model.keys.has('goal:g1')).toBe(true)
    expect(model.keys.has('task:t9')).toBe(false)
  })
})

describe('computeTerritoryHighlight', () => {
  const model = buildTerritoryModel({ projects, identities, tasks, goals, decisions })

  it('returns null without a selection', () => {
    expect(computeTerritoryHighlight(null, model)).toBeNull()
  })

  it('lights an identity with all of its projects including shared ones', () => {
    const highlight = computeTerritoryHighlight(identities[0], model)
    expect([...highlight.projectIds].sort()).toEqual(['p1', 'p2'])
    expect(highlight.identityIds.has('i1')).toBe(true)
    expect(highlight.goalIds.has('g1')).toBe(true)
    expect(highlight.chipKeys).toBeNull()
  })

  it('lights a goal with its linked projects and their owners', () => {
    const highlight = computeTerritoryHighlight(goals[0], model)
    expect([...highlight.projectIds].sort()).toEqual(['p1', 'p4'])
    expect(highlight.identityIds.has('i1')).toBe(true)
    expect(highlight.identityIds.has('i2')).toBe(true)
  })

  it('narrows to chip level for a selected task and its dependency neighbors', () => {
    const links = [{ from: 'task:t2', to: 'task:t3', type: 'dependency' }]
    const highlight = computeTerritoryHighlight(tasks[1], model, links)
    expect(highlight.chipKeys.has('task:t2')).toBe(true)
    expect(highlight.chipKeys.has('task:t3')).toBe(true)
    expect([...highlight.projectIds].sort()).toEqual(['p1', 'p4'])
  })

  it('narrows to chip level for a selected decision', () => {
    const highlight = computeTerritoryHighlight(decisions[0], model)
    expect(highlight.chipKeys.has('decision:d1')).toBe(true)
    expect(highlight.projectIds.has('p4')).toBe(true)
  })
})

// A container nested under another (ADR-0069): drawn inside its parent's card,
// so it must not also take a lane slot of its own.
const nestedProjects = [
  { id: 'root', type: 'project', name: 'Root', risk: 'normal', identityIds: ['i1'] },
  { id: 'inner', type: 'project', name: 'Inner', risk: 'failed', identityIds: ['i2'], parentContainerId: 'root' },
  { id: 'deep', type: 'project', name: 'Deep', risk: 'normal', identityIds: [], parentContainerId: 'inner' },
]
const nestedTasks = [
  { id: 'nt', type: 'task', projectId: 'deep', name: 'Deep task', risk: 'normal', blockedBy: [], blocking: [] },
]

describe('nested containers (ADR-0069)', () => {
  const model = buildTerritoryModel({ projects: nestedProjects, identities, tasks: nestedTasks, goals: [], decisions: [] })

  it('gives a lane slot to roots only, and hangs the rest off their parent', () => {
    expect(model.territories[0].projects.map(p => p.id)).toEqual(['root'])
    // Owned by i2, but its place is inside its parent — ownership does not lift it out.
    expect(model.territories[1].projects).toEqual([])
    expect(model.shared).toEqual([])
    expect(model.unowned).toEqual([])
    expect(model.childrenByProject.get('root').map(p => p.id)).toEqual(['inner'])
    expect(model.childrenByProject.get('inner').map(p => p.id)).toEqual(['deep'])
  })

  it('still keys every container so selection can reach a nested card', () => {
    expect(model.keys.has('project:deep')).toBe(true)
  })

  it('lights the whole chain when a container is selected', () => {
    const highlight = computeTerritoryHighlight({ type: 'project', id: 'inner' }, model, [])
    // Its parent stays lit (a dark parent would hide the lit child drawn inside it)
    // and what it contains is part of what was selected.
    expect([...highlight.projectIds].sort()).toEqual(['deep', 'inner', 'root'])
  })

  it('lights the ancestors of a selected nested task', () => {
    const highlight = computeTerritoryHighlight({ type: 'task', id: 'nt' }, model, [])
    expect([...highlight.projectIds].sort()).toEqual(['deep', 'inner', 'root'])
  })
})
