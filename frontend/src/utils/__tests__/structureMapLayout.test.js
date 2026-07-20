import { describe, expect, it } from 'vitest'
import { buildMindMapLayout, buildNetworkLayout, buildTreeLayout } from '../structureMapLayout'

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
    expect(layout.width).toBeLessThan(2400)
    expect(layout.height).toBeLessThan(2000)
  })

  it('rings tasks outside projects outside identities', () => {
    const center = layout.orbit
    const dist = (n) => Math.hypot(n.x + n.w / 2 - center.cx, (n.y + n.h / 2 - center.cy) / center.squash)
    const maxIdentity = Math.max(...layout.nodes.filter(n => n.type === 'identity').map(dist))
    const minProject = Math.min(...layout.nodes.filter(n => n.type === 'project').map(dist))
    const maxProject = Math.max(...layout.nodes.filter(n => n.type === 'project').map(dist))
    const minTask = Math.min(...layout.nodes.filter(n => n.type === 'task').map(dist))
    expect(maxIdentity).toBeLessThan(minProject)
    expect(maxProject).toBeLessThan(minTask)
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

describe('buildTreeLayout', () => {
  const layout = buildTreeLayout(params)

  it('stacks levels top-down: identities above projects above tasks', () => {
    const maxY = (type) => Math.max(...layout.nodes.filter(n => n.type === type).map(n => n.y + n.h))
    const minY = (type) => Math.min(...layout.nodes.filter(n => n.type === type).map(n => n.y))
    expect(maxY('identity')).toBeLessThanOrEqual(minY('project'))
    expect(maxY('project')).toBeLessThanOrEqual(minY('task'))
  })

  it('produces no overlapping nodes', () => {
    expect(countOverlaps(layout.nodes)).toBe(0)
  })

  it('centers each project over its tasks', () => {
    const projectNode = layout.nodeById.get('project:p0')
    const taskNodes = layout.nodes.filter(n => n.type === 'task' && n.data.projectId === 'p0')
    expect(taskNodes.length).toBeGreaterThan(1)
    const tasksCenter = (Math.min(...taskNodes.map(n => n.x)) + Math.max(...taskNodes.map(n => n.x + n.w))) / 2
    expect(projectNode.x + projectNode.w / 2).toBeCloseTo(tasksCenter, 5)
  })

  it('centers each identity over its project subtrees', () => {
    // Identity i0 owns p0 and p9 (i % 9 assignment over 17 projects).
    const identityNode = layout.nodeById.get('identity:i0')
    const owned = layout.nodes.filter(n => n.type === 'project' && n.data.identityIds.includes('i0'))
    expect(owned.length).toBe(2)
    const left = Math.min(...owned.map(n => n.x))
    const right = Math.max(...owned.map(n => n.x + n.w))
    const center = identityNode.x + identityNode.w / 2
    expect(center).toBeGreaterThan(left)
    expect(center).toBeLessThan(right)
  })

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

  it('is deterministic for identical input', () => {
    const again = buildTreeLayout(params)
    expect(again.nodes.map(n => [n.id, n.x, n.y])).toEqual(layout.nodes.map(n => [n.id, n.x, n.y]))
  })
})
