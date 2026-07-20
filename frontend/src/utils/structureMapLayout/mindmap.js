import { STATUS_COLOR } from '../../constants/theme'
import { riskColor, resolveOverlaps } from './core'
import { assignSankeySlots } from './ribbon'

export function buildMindMapLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
  const pad = { x: 56, y: 46 }
  const colDef = {
    identity: { x: pad.x + 16, w: 150 },
    project: { x: pad.x + 262, w: 208 },
    task: { x: pad.x + 556, w: 190 },
  }
  const contentW = colDef.task.x + colDef.task.w - colDef.identity.x
  const canvasW = contentW + pad.x * 2 + 32
  const labelH = 24
  const projectH = 62
  const taskH = 46
  const identityH = 46
  const goalH = 38
  const decisionH = 38
  const taskGapV = 4
  const rowPad = 10
  const goalW = 168
  const goalGapH = 10

  const tasksByProject = new Map()
  visibleTaskNodes.forEach(task => {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  })

  // Goals live in a full-width labelled band above the columns; decisions get
  // a matching band below. Relations stay data-only: their arcs render only
  // while a linked node is selected (mirrors the territory view language).
  const goalLane = laneNodes.filter(n => n.lane === 'goal')
  const decisionLane = laneNodes.filter(n => n.lane === 'decision')
  const bandCols = Math.max(1, Math.floor((contentW + goalGapH) / (goalW + goalGapH)))
  const goalCols = Math.min(goalLane.length, bandCols) || 1
  const goalRows = Math.ceil(goalLane.length / goalCols)
  const goalAreaH = goalLane.length > 0 ? labelH + goalRows * (goalH + 6) + 12 : 0

  const bodyTop = pad.y + goalAreaH + labelH + 6

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

  const bands = []
  const totalGoalW = goalCols * goalW + (goalCols - 1) * goalGapH
  const goalStartX = colDef.identity.x + Math.max(0, (contentW - totalGoalW) / 2)

  if (goalLane.length > 0) {
    bands.push({ key: 'goals', x: colDef.identity.x, y: pad.y, w: contentW })
  }
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

  const decisionTop = bodyY + labelH + 16
  const decisionColCount = Math.min(decisionLane.length, bandCols) || 1
  const totalDecW = decisionColCount * goalW + (decisionColCount - 1) * goalGapH
  const decStartX = colDef.identity.x + Math.max(0, (contentW - totalDecW) / 2)

  if (decisionLane.length > 0) {
    bands.push({ key: 'decisions', x: colDef.identity.x, y: decisionTop - labelH, w: contentW })
  }
  decisionLane.forEach((decision, i) => {
    nodes.push({
      id: `decision:${decision.id}`,
      type: 'decision',
      name: decision.name,
      x: decStartX + (i % decisionColCount) * (goalW + goalGapH),
      y: decisionTop + Math.floor(i / decisionColCount) * (decisionH + 6),
      w: goalW,
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

  const decAreaH = decisionLane.length > 0
    ? labelH + Math.ceil(decisionLane.length / decisionColCount) * (decisionH + 6) + 28
    : 0
  const canvasH = Math.max(520, bodyY + decAreaH + pad.y + 24)

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
    bands,
    labelH,
    labelY: bodyTop - labelH,
    padY: pad.y,
  }
}
