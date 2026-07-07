import { describe, expect, it } from 'vitest'
import { buildMindMapLayout, buildNetworkLayout } from '../structureMapLayout'

const identities = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, name: `Persona ${i}`, color: '#818cf8' }))
const projects = Array.from({ length: 17 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  risk: 'active',
  progress: 40,
  doneTasks: 1,
  totalTasks: 3,
  failed: 0,
  overdue: 0,
  pendingDecisionCount: 0,
  identityIds: [`i${i % 9}`],
}))
const tasks = Array.from({ length: 28 }, (_, i) => ({
  id: `t${i}`,
  name: `Task ${i}`,
  projectId: `p${i % 17}`,
  risk: 'active',
  status: 'in_progress',
  color: '#facc15',
  blockedBy: [],
  blocking: [],
}))
const laneNodes = Array.from({ length: 18 }, (_, i) => (i % 2 === 0
  ? { id: `g${i}`, lane: 'goal', name: `Goal ${i}`, color: '#34d399', projectIds: [`p${i % 17}`] }
  : { id: `d${i}`, lane: 'decision', name: `Decision ${i}`, color: '#facc15', status: 'proposed', projectId: `p${i % 17}` }))

const params = {
  visibleProjects: projects,
  visibleIdentityNodes: identities,
  visibleTaskNodes: tasks,
  laneNodes,
  dependencyLinks: [],
  viewMode: 'map',
}

function countOverlaps(nodes) {
  let overlaps = 0
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++
    }
  }
  return overlaps
}

describe('buildNetworkLayout', () => {
  const layout = buildNetworkLayout(params)

  it('produces no overlapping nodes', () => {
    expect(countOverlaps(layout.nodes)).toBe(0)
  })

  it('keeps the canvas bounded so fit-to-view stays readable', () => {
    expect(layout.width).toBeLessThan(2200)
    expect(layout.height).toBeLessThan(1700)
  })

  it('is deterministic for identical input', () => {
    const again = buildNetworkLayout(params)
    expect(again.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)]))
      .toEqual(layout.nodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)]))
  })
})

describe('buildMindMapLayout', () => {
  const layout = buildMindMapLayout(params)

  it('places goals in a top band and decisions in a bottom band', () => {
    expect(layout.bands.map(band => band.key)).toEqual(['goals', 'decisions'])
    const goalNodes = layout.nodes.filter(n => n.type === 'goal')
    const decisionNodes = layout.nodes.filter(n => n.type === 'decision')
    const bodyNodes = layout.nodes.filter(n => ['identity', 'project', 'task'].includes(n.type))
    const bodyTop = Math.min(...bodyNodes.map(n => n.y))
    const bodyBottom = Math.max(...bodyNodes.map(n => n.y + n.h))
    expect(Math.max(...goalNodes.map(n => n.y + n.h))).toBeLessThanOrEqual(bodyTop)
    expect(Math.min(...decisionNodes.map(n => n.y))).toBeGreaterThanOrEqual(bodyBottom)
  })

  it('exposes a label row between the goal band and the columns', () => {
    expect(layout.labelY).toBeGreaterThan(layout.padY)
  })
})
