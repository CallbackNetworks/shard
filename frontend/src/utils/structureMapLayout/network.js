import { STATUS_COLOR } from '../../constants/theme'
import { riskColor } from './core'

// A gentle center-to-center arc for the force-directed network view, where
// edges run at arbitrary angles instead of column to column.
export function networkPath(from, to) {
  const x1 = from.x + from.w / 2
  const y1 = from.y + from.h / 2
  const x2 = to.x + to.w / 2
  const y2 = to.y + to.h / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(28, len * 0.12)
  const mx = (x1 + x2) / 2 + (-dy / len) * bow
  const my = (y1 + y2) / 2 + (dx / len) * bow
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

// Safety net after the deterministic radial placement: re-place any node that
// still collides (rare diagonal cases) by spiralling outwards from its slot to
// the nearest free spot. Deterministic; normally a no-op.
function separateRects(nodes, gap = 12) {
  const placed = []
  const collides = (x, y, node) => placed.some(p =>
    Math.abs(x - p.x) < (node.w + p.w) / 2 + gap &&
    Math.abs(y - p.y) < (node.h + p.h) / 2 + gap
  )

  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const node of ordered) {
    if (!collides(node.x, node.y, node)) {
      placed.push(node)
      continue
    }
    let best = null
    for (let radius = 26; radius <= 640 && !best; radius += 26) {
      const steps = Math.max(8, Math.round((radius / 26) * 6))
      for (let step = 0; step < steps; step++) {
        const angle = (step / steps) * Math.PI * 2
        const x = node.x + Math.cos(angle) * radius
        const y = node.y + Math.sin(angle) * radius * 0.72
        if (!collides(x, y, node)) {
          best = { x, y }
          break
        }
      }
    }
    if (best) {
      node.x = best.x
      node.y = best.y
    }
    placed.push(node)
  }
}

const NETWORK_SIZE = {
  identity: { w: 140, h: 46 },
  project: { w: 180, h: 60 },
  task: { w: 150, h: 44 },
  goal: { w: 138, h: 44 },
  decision: { w: 138, h: 44 },
  custom: { w: 138, h: 44 },
}

// Sector-orbit layout (radial tidy tree): every identity owns an angular
// sector sized by how many tasks live under it, projects sit on an inner
// orbit inside their identity's sector, tasks on an outer orbit inside their
// project's slice, and goals/pending decisions float on the outermost ring at
// the mean angle of what they link to. Angles are allocated by need, so the
// picture is deterministic and collision-free by construction; rings are
// staggered into two sub-orbits to halve the required radius.
export function buildNetworkLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode, customNodes = [], customLinks = [] }) {
  const nodes = []
  const links = []

  const pushNode = (id, type, name, color, data) => {
    const size = NETWORK_SIZE[type] || { w: 150, h: 46 }
    nodes.push({ id, type, name, color, data, w: size.w, h: size.h, x: 0, y: 0 })
  }

  visibleIdentityNodes.forEach(identity =>
    pushNode(`identity:${identity.id}`, 'identity', identity.name, identity.color, { ...identity, type: 'identity' })
  )
  visibleProjects.forEach(project =>
    pushNode(`project:${project.id}`, 'project', project.name, riskColor(project.risk), project)
  )
  visibleTaskNodes.forEach(task =>
    pushNode(`task:${task.id}`, 'task', task.name, task.color, task)
  )
  laneNodes.forEach(node => {
    if (node.lane === 'goal') pushNode(`goal:${node.id}`, 'goal', node.name, node.color, node)
    else pushNode(`decision:${node.id}`, 'decision', node.name, node.color, node)
  })
  customNodes.forEach(node =>
    pushNode(`custom:${node.id}`, 'custom', node.name, node.typeColor, node)
  )

  const identityColorById = new Map(visibleIdentityNodes.map(identity => [identity.id, identity.color]))
  visibleProjects.forEach(project => {
    project.identityIds.forEach(identityId => {
      links.push({ from: `identity:${identityId}`, to: `project:${project.id}`, color: identityColorById.get(identityId) || '#64748b', type: 'owns' })
    })
  })
  visibleTaskNodes.forEach(task => {
    links.push({ from: `project:${task.projectId}`, to: `task:${task.id}`, color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk), type: task.risk })
  })
  laneNodes.forEach(node => {
    if (node.lane === 'goal') {
      (node.projectIds || []).forEach(projectId => links.push({ from: `goal:${node.id}`, to: `project:${projectId}`, color: node.color, type: 'goal' }))
    } else if (node.projectId) {
      links.push({ from: `decision:${node.id}`, to: `project:${node.projectId}`, color: node.color, type: 'decision' })
    }
  })
  if (viewMode === 'dependencies') {
    dependencyLinks.forEach(link => links.push({ from: link.from, to: link.to, color: STATUS_COLOR.failed, type: 'dependency' }))
  }
  // Graph-native extensions (ADR-0037): nested containment between containers,
  // custom plain nodes hanging off their container, and custom relation edges.
  visibleProjects.forEach(project => {
    if (project.parentContainerId) {
      links.push({ from: `project:${project.parentContainerId}`, to: `project:${project.id}`, color: '#64748b', type: 'contains' })
    }
  })
  customNodes.forEach(node => {
    if (node.parentProjectId) {
      links.push({ from: `project:${node.parentProjectId}`, to: `custom:${node.id}`, color: node.typeColor || '#64748b', type: 'contains' })
    }
  })
  customLinks.forEach(link => {
    links.push({ from: link.from, to: link.to, color: '#64748b', type: 'custom', label: link.label })
  })

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))

  const TAU = Math.PI * 2
  const SQUASH = 0.86

  // --- Cluster the forest: one sector per identity, plus one for unowned ---
  const tasksByProject = new Map()
  visibleTaskNodes.forEach(task => {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  })

  const identityIdSet = new Set(visibleIdentityNodes.map(identity => identity.id))
  const clusters = visibleIdentityNodes.map(identity => ({ identityId: identity.id, projects: [] }))
  const clusterByIdentity = new Map(clusters.map(cluster => [cluster.identityId, cluster]))
  const unownedCluster = { identityId: null, projects: [] }
  visibleProjects.forEach(project => {
    const ownerId = (project.identityIds || []).find(id => identityIdSet.has(id))
    const cluster = clusterByIdentity.get(ownerId)
    if (cluster) cluster.projects.push(project)
    else unownedCluster.projects.push(project)
  })
  if (unownedCluster.projects.length > 0) clusters.push(unownedCluster)

  // Weight = angular need. A project needs one unit per task (min one unit);
  // an empty identity still gets a sliver so its node has room.
  const projectWeight = (project) => Math.max(tasksByProject.get(project.id)?.length || 0, 1)
  clusters.forEach(cluster => {
    cluster.weight = cluster.projects.reduce((sum, project) => sum + projectWeight(project), 0) || 0.5
  })
  const totalWeight = clusters.reduce((sum, cluster) => sum + cluster.weight, 0)

  const gapAngle = clusters.length > 1 ? 0.05 : 0
  const usable = TAU - clusters.length * gapAngle
  const unitAngle = usable / Math.max(totalWeight, 1)

  // --- Ring radii sized from angular need (two staggered sub-orbits) ---
  const PROJECT_ARC = 208
  const TASK_ARC = 166
  const LANE_ARC = 172
  const r2 = Math.max(280, PROJECT_ARC / Math.max(unitAngle, 0.0001) / 2)
  const r2b = r2 + 96
  const r3 = Math.max(r2b + 140, TASK_ARC / Math.max(unitAngle, 0.0001) / 2)
  const r3b = r3 + 84
  const laneCount = laneNodes.length + customNodes.length
  const r4 = Math.max(r3b + 150, (laneCount * LANE_ARC) / TAU)
  const r1 = Math.max(130, r2 * 0.42)

  const maxR = laneCount > 0 ? r4 : r3b
  const edgePad = 130
  const cx = maxR + edgePad
  const cy = maxR * SQUASH + edgePad
  const place = (node, angle, radius) => {
    node.x = cx + Math.cos(angle) * radius
    node.y = cy + Math.sin(angle) * radius * SQUASH
  }

  // --- Walk sectors: identity mid-sector, projects and tasks inside it ---
  let cursor = -Math.PI / 2
  let projectIndex = 0
  const projectAngleById = new Map()
  clusters.forEach(cluster => {
    const span = cluster.weight * unitAngle
    const identityNode = cluster.identityId ? nodeById.get(`identity:${cluster.identityId}`) : null
    if (identityNode) place(identityNode, cursor + span / 2, r1)

    let projectCursor = cursor
    cluster.projects.forEach(project => {
      const projectSpan = projectWeight(project) * unitAngle
      const projectAngle = projectCursor + projectSpan / 2
      const projectNode = nodeById.get(`project:${project.id}`)
      if (projectNode) place(projectNode, projectAngle, projectIndex % 2 === 0 ? r2 : r2b)
      projectAngleById.set(project.id, projectAngle)
      projectIndex += 1

      const tasks = tasksByProject.get(project.id) || []
      tasks.forEach((task, i) => {
        const taskAngle = projectCursor + ((i + 0.5) / tasks.length) * projectSpan
        const taskNode = nodeById.get(`task:${task.id}`)
        if (taskNode) place(taskNode, taskAngle, i % 2 === 0 ? r3 : r3b)
      })
      projectCursor += projectSpan
    })
    cursor += span + gapAngle
  })

  // --- Outer ring: goals, decisions, and custom plain nodes aim at the
  // circular mean of what they link to, then get nudged apart ---
  const customProjectIds = new Map(customNodes.map(node => {
    const key = `custom:${node.id}`
    const linked = new Set(node.parentProjectId ? [node.parentProjectId] : [])
    for (const link of customLinks) {
      const other = link.from === key ? link.to : link.to === key ? link.from : null
      if (other?.startsWith('project:')) linked.add(other.slice('project:'.length))
    }
    return [node.id, [...linked]]
  }))
  const outerEntries = [
    ...laneNodes.map(node => ({
      key: `${node.lane === 'goal' ? 'goal' : 'decision'}:${node.id}`,
      linkedIds: (node.projectIds || (node.projectId ? [node.projectId] : [])),
    })),
    ...customNodes.map(node => ({
      key: `custom:${node.id}`,
      linkedIds: customProjectIds.get(node.id) || [],
    })),
  ].map(entry => {
    const linkedIds = entry.linkedIds.filter(id => projectAngleById.has(id))
    let angle = -Math.PI / 2
    if (linkedIds.length > 0) {
      const sumX = linkedIds.reduce((sum, id) => sum + Math.cos(projectAngleById.get(id)), 0)
      const sumY = linkedIds.reduce((sum, id) => sum + Math.sin(projectAngleById.get(id)), 0)
      angle = Math.atan2(sumY, sumX)
    }
    return { key: entry.key, angle }
  }).sort((a, b) => a.angle - b.angle)

  const minLaneGap = LANE_ARC / Math.max(r4, 1)
  for (let i = 1; i < outerEntries.length; i++) {
    if (outerEntries[i].angle < outerEntries[i - 1].angle + minLaneGap) {
      outerEntries[i].angle = outerEntries[i - 1].angle + minLaneGap
    }
  }
  outerEntries.forEach(({ key, angle }) => {
    const outerNode = nodeById.get(key)
    if (outerNode) place(outerNode, angle, r4)
  })

  separateRects(nodes)

  const pad = 60
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  nodes.forEach(node => {
    node.x -= node.w / 2
    node.y -= node.h / 2
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.w)
    maxY = Math.max(maxY, node.y + node.h)
  })
  if (!nodes.length) {
    minX = 0
    minY = 0
    maxX = 900
    maxY = 600
  }
  nodes.forEach(node => {
    node.x += pad - minX
    node.y += pad - minY
  })

  return {
    nodes,
    links: validLinks,
    nodeById,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    columns: null,
    orbit: nodes.length
      ? {
          cx: cx + pad - minX,
          cy: cy + pad - minY,
          squash: SQUASH,
          rings: laneCount > 0 ? [r1, r2, r2b, r3, r3b, r4] : [r1, r2, r2b, r3, r3b],
        }
      : null,
  }
}
