import { STATUS_COLOR } from '../constants/theme'

export function riskColor(risk) {
  if (risk === 'failed' || risk === 'overdue') return STATUS_COLOR.failed
  if (risk === 'active' || risk === 'priority') return STATUS_COLOR.in_progress
  return STATUS_COLOR.todo
}

export function taskWeight(task) {
  const riskScore = {
    failed: 90,
    overdue: 80,
    priority: 70,
    active: 60,
    normal: 10,
  }[task.risk] || 10
  return riskScore + (task.blockedBy?.length || 0) * 12 + (task.blocking?.length || 0) * 10
}

function resolveOverlaps(items, minGap) {
  if (items.length <= 1) return
  items.sort((a, b) => a.y - b.y)
  for (let i = 1; i < items.length; i++) {
    const minY = items[i - 1].y + items[i - 1].h + minGap
    if (items[i].y < minY) items[i].y = minY
  }
}

export function computePath(from, to, linkType) {
  const fromCy = from.y + from.h / 2
  const toCy = to.y + to.h / 2
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2)

  if (linkType === 'dependency') {
    const x1 = from.x + from.w
    const x2 = to.x + to.w
    const arc = 28 + Math.abs(toCy - fromCy) * 0.1
    return `M ${x1} ${fromCy} C ${x1 + arc} ${fromCy}, ${x2 + arc} ${toCy}, ${x2} ${toCy}`
  }

  if (Math.abs(dx) > 80) {
    const goRight = dx > 0
    const x1 = goRight ? from.x + from.w : from.x
    const x2 = goRight ? to.x : to.x + to.w
    const bend = Math.max(20, Math.abs(x2 - x1) * 0.35)
    const dir = goRight ? 1 : -1
    return `M ${x1} ${fromCy} C ${x1 + dir * bend} ${fromCy}, ${x2 - dir * bend} ${toCy}, ${x2} ${toCy}`
  }

  const goDown = toCy > fromCy
  const x1 = from.x + from.w / 2
  const y1 = goDown ? from.y + from.h : from.y
  const x2 = to.x + to.w / 2
  const y2 = goDown ? to.y : to.y + to.h
  const bend = Math.max(20, Math.abs(y2 - y1) * 0.4)
  const dir = goDown ? 1 : -1
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${x2} ${y2 - dir * bend}, ${x2} ${y2}`
}

export function buildMindMapLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
  const pad = { x: 120, y: 80 }
  const colDef = {
    identity: { x: pad.x + 24, w: 138 },
    project: { x: pad.x + 228, w: 196 },
    task: { x: pad.x + 490, w: 176 },
  }
  const contentW = 710
  const canvasW = contentW + pad.x * 2
  const labelH = 24
  const projectH = 62
  const taskH = 46
  const identityH = 46
  const goalH = 38
  const decisionH = 38
  const taskGapV = 4
  const rowPad = 10

  const tasksByProject = new Map()
  visibleTaskNodes.forEach(task => {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  })

  const goalLane = laneNodes.filter(n => n.lane === 'goal')
  const decisionLane = laneNodes.filter(n => n.lane === 'decision')
  const goalCols = Math.min(goalLane.length, 3) || 1
  const goalRows = Math.ceil(goalLane.length / goalCols)
  const goalAreaH = goalLane.length > 0 ? goalRows * (goalH + 6) + 8 : 0

  const bodyTop = pad.y + labelH + goalAreaH + 6

  const projectRowData = []
  let bodyY = bodyTop
  visibleProjects.forEach(project => {
    const tasks = tasksByProject.get(project.id) || []
    const stackH = tasks.length > 0 ? tasks.length * (taskH + taskGapV) - taskGapV : 0
    const rowH = Math.max(projectH, stackH) + rowPad
    projectRowData.push({ project, y: bodyY, h: rowH, tasks })
    bodyY += rowH
  })

  const nodes = []
  const links = []

  projectRowData.forEach(row => {
    const py = row.y + (row.h - rowPad - projectH) / 2
    nodes.push({
      id: `project:${row.project.id}`,
      type: 'project',
      name: row.project.name,
      x: colDef.project.x,
      y: py,
      w: colDef.project.w,
      h: projectH,
      color: riskColor(row.project.risk),
      data: row.project,
    })
  })

  const projectYMap = new Map(
    nodes.filter(n => n.type === 'project').map(n => [n.data.id, n.y])
  )

  const identityItems = visibleIdentityNodes.map((identity, i) => {
    const connYs = visibleProjects
      .filter(p => p.identityIds.includes(identity.id))
      .map(p => projectYMap.get(p.id))
      .filter(y => y !== undefined)
    const idealY = connYs.length > 0
      ? connYs.reduce((a, b) => a + b, 0) / connYs.length + (projectH - identityH) / 2
      : bodyTop + i * (identityH + 8)
    return { identity, y: idealY, h: identityH }
  })
  resolveOverlaps(identityItems, 8)

  identityItems.forEach(({ identity, y }) => {
    nodes.push({
      id: `identity:${identity.id}`,
      type: 'identity',
      name: identity.name,
      x: colDef.identity.x,
      y,
      w: colDef.identity.w,
      h: identityH,
      color: identity.color,
      data: { ...identity, type: 'identity' },
    })
  })

  const identityColorById = new Map(visibleIdentityNodes.map(identity => [identity.id, identity.color]))
  visibleProjects.forEach(project => {
    project.identityIds.forEach(identityId => {
      links.push({
        from: `identity:${identityId}`,
        to: `project:${project.id}`,
        color: identityColorById.get(identityId) || '#64748b',
        type: 'owns',
        flow: true,
      })
    })
  })

  projectRowData.forEach(row => {
    const py = projectYMap.get(row.project.id)
    if (py === undefined) return
    const tasks = row.tasks
    const stackH = tasks.length > 0 ? tasks.length * (taskH + taskGapV) - taskGapV : 0
    const stackTop = py + (projectH - stackH) / 2

    tasks.forEach((task, i) => {
      nodes.push({
        id: `task:${task.id}`,
        type: 'task',
        name: task.name,
        x: colDef.task.x,
        y: stackTop + i * (taskH + taskGapV),
        w: colDef.task.w,
        h: taskH,
        color: task.color,
        data: task,
      })
      links.push({
        from: `project:${row.project.id}`,
        to: `task:${task.id}`,
        color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk),
        type: task.risk,
        flow: true,
      })
    })
  })

  if (viewMode === 'dependencies') {
    dependencyLinks.forEach(link => {
      links.push({
        from: link.from,
        to: link.to,
        color: STATUS_COLOR.failed,
        type: 'dependency',
      })
    })
  }

  const goalW = 138
  const goalGapH = 8
  const totalGoalW = goalCols * goalW + (goalCols - 1) * goalGapH
  const goalStartX = colDef.project.x + (colDef.project.w - totalGoalW) / 2

  goalLane.forEach((goal, i) => {
    nodes.push({
      id: `goal:${goal.id}`,
      type: 'goal',
      name: goal.name,
      x: goalStartX + (i % goalCols) * (goalW + goalGapH),
      y: pad.y + labelH + Math.floor(i / goalCols) * (goalH + 6),
      w: goalW,
      h: goalH,
      color: goal.color,
      data: goal,
    })
    goal.projectIds?.forEach(projectId => links.push({
      from: `goal:${goal.id}`,
      to: `project:${projectId}`,
      color: goal.color,
      type: 'goal',
    }))
  })

  const decisionTop = bodyY + 12
  const decisionColCount = Math.min(decisionLane.length, 3) || 1
  const decW = 134
  const decGapH = 8
  const totalDecW = decisionColCount * decW + (decisionColCount - 1) * decGapH
  const decStartX = colDef.project.x + (colDef.project.w - totalDecW) / 2

  decisionLane.forEach((decision, i) => {
    nodes.push({
      id: `decision:${decision.id}`,
      type: 'decision',
      name: decision.name,
      x: decStartX + (i % decisionColCount) * (decW + decGapH),
      y: decisionTop + Math.floor(i / decisionColCount) * (decisionH + 6),
      w: decW,
      h: decisionH,
      color: decision.color,
      data: decision,
    })
    if (decision.projectId) {
      links.push({
        from: `decision:${decision.id}`,
        to: `project:${decision.projectId}`,
        color: decision.color,
        type: 'decision',
      })
    }
  })

  const decAreaH = decisionLane.length > 0 ? Math.ceil(decisionLane.length / decisionColCount) * (decisionH + 6) + 24 : 0
  const canvasH = Math.max(520, bodyY + decAreaH + pad.y + 40)

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))
  assignSankeySlots(validLinks, nodeById)
  return {
    nodes,
    links: validLinks,
    nodeById,
    width: canvasW,
    height: canvasH,
    columns: colDef,
    labelH,
    padY: pad.y,
  }
}

const RIBBON_MAX = 20

function nodeCenterY(node) {
  return node.y + node.h / 2
}

// Allocate stacked vertical slots on each node edge for flow ribbons,
// so ribbons fan out along the node height instead of all meeting at the center.
function assignSankeySlots(links, nodeById) {
  const outgoing = new Map()
  const incoming = new Map()
  for (const link of links) {
    if (!link.flow) continue
    if (!outgoing.has(link.from)) outgoing.set(link.from, [])
    if (!incoming.has(link.to)) incoming.set(link.to, [])
    outgoing.get(link.from).push(link)
    incoming.get(link.to).push(link)
  }

  for (const [nodeId, group] of outgoing) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.to)) - nodeCenterY(nodeById.get(b.to)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.sourceX = node.x + node.w
      link.sourceY = node.y + 4 + (i + 0.5) * slot
      link.sourceW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }

  for (const [nodeId, group] of incoming) {
    const node = nodeById.get(nodeId)
    group.sort((a, b) => nodeCenterY(nodeById.get(a.from)) - nodeCenterY(nodeById.get(b.from)))
    const usable = node.h - 8
    const slot = usable / group.length
    group.forEach((link, i) => {
      link.targetX = node.x
      link.targetY = node.y + 4 + (i + 0.5) * slot
      link.targetW = Math.min(slot - 1.5, RIBBON_MAX)
    })
  }
}

// A filled, tapered Sankey band between a source node's right edge and a
// target node's left edge (falls back to node centers if slots are unset).
export function ribbonPath(link, from, to) {
  const x0 = link.sourceX ?? from.x + from.w
  const x1 = link.targetX ?? to.x
  const sy = link.sourceY ?? nodeCenterY(from)
  const ty = link.targetY ?? nodeCenterY(to)
  const sw = Math.max(2, link.sourceW ?? 6)
  const tw = Math.max(2, link.targetW ?? 6)
  const cx = (x0 + x1) / 2
  return [
    `M ${x0} ${sy - sw / 2}`,
    `C ${cx} ${sy - sw / 2}, ${cx} ${ty - tw / 2}, ${x1} ${ty - tw / 2}`,
    `L ${x1} ${ty + tw / 2}`,
    `C ${cx} ${ty + tw / 2}, ${cx} ${sy + sw / 2}, ${x0} ${sy + sw / 2}`,
    'Z',
  ].join(' ')
}

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

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NETWORK_SIZE = {
  identity: { w: 140, h: 46 },
  project: { w: 180, h: 60 },
  task: { w: 150, h: 44 },
  goal: { w: 138, h: 44 },
  decision: { w: 138, h: 44 },
}

// Deterministic force-directed layout. Runs a fixed number of settling
// iterations so the same inputs always produce the same picture.
export function buildNetworkLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
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

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))

  const width = 1200
  const height = 820
  const cx = width / 2
  const cy = height / 2
  const rng = mulberry32((nodes.length * 2654435761) >>> 0)
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2
    const radius = Math.min(width, height) * 0.34
    node.x = cx + Math.cos(angle) * radius + (rng() - 0.5) * 60
    node.y = cy + Math.sin(angle) * radius + (rng() - 0.5) * 60
    node.vx = 0
    node.vy = 0
  })

  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const springLen = 150
  const springK = 0.025
  const repulse = 9000
  const gravity = 0.02
  const damping = 0.86
  for (let iter = 0; iter < 320; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x
        let dy = nodes[i].y - nodes[j].y
        const d2 = dx * dx + dy * dy + 0.01
        const d = Math.sqrt(d2)
        const f = repulse / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        nodes[i].vx += fx
        nodes[i].vy += fy
        nodes[j].vx -= fx
        nodes[j].vy -= fy
      }
    }
    for (const link of validLinks) {
      const a = nodes[index.get(link.from)]
      const b = nodes[index.get(link.to)]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const f = (d - springLen) * springK
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
    for (const node of nodes) {
      node.vx += (cx - node.x) * gravity
      node.vy += (cy - node.y) * gravity
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx
      node.y += node.vy
    }
  }

  const pad = 90
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
    maxX = width
    maxY = height
  }
  nodes.forEach(node => {
    node.x += pad - minX
    node.y += pad - minY
    delete node.vx
    delete node.vy
  })

  return {
    nodes,
    links: validLinks,
    nodeById,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    columns: null,
  }
}
