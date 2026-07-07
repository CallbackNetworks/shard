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
