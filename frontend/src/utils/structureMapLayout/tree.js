import { STATUS_COLOR } from '../../constants/theme'
import { riskColor } from './core'

// Standard top-down tidy tree for the "tree" (formerly lines) style:
// identities form the roots, projects sit centered under their owning
// identity, and signal tasks form a row under their project. Subtree widths
// are computed bottom-up so parents center over their children; goals keep
// their band above the tree and decisions theirs below, as in the mind map.
export function buildTreeLayout({ visibleProjects, visibleIdentityNodes, visibleTaskNodes, laneNodes, dependencyLinks, viewMode }) {
  const pad = { x: 56, y: 46 }
  const identityW = 150
  const identityH = 46
  const projectW = 208
  const projectH = 62
  const taskW = 172
  const taskH = 46
  const siblingGap = 16
  const clusterGap = 34
  const levelGap = 66
  const labelH = 24
  const goalW = 168
  const goalH = 38
  const decisionH = 38
  const goalGapH = 10

  const tasksByProject = new Map()
  visibleTaskNodes.forEach(task => {
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  })

  // One subtree per identity; a project hangs under its first visible owner
  // (extra owners still get link edges), ownerless projects form a trailing
  // rootless cluster.
  const identityIdSet = new Set(visibleIdentityNodes.map(identity => identity.id))
  const clusters = visibleIdentityNodes.map(identity => ({ identity, projects: [] }))
  const clusterByIdentity = new Map(clusters.map(cluster => [cluster.identity.id, cluster]))
  const unowned = { identity: null, projects: [] }
  visibleProjects.forEach(project => {
    const ownerId = (project.identityIds || []).find(id => identityIdSet.has(id))
    ;(clusterByIdentity.get(ownerId) || unowned).projects.push(project)
  })
  if (unowned.projects.length > 0) clusters.push(unowned)

  const projectSubW = (project) => {
    const count = tasksByProject.get(project.id)?.length || 0
    const tasksW = count > 0 ? count * taskW + (count - 1) * siblingGap : 0
    return Math.max(projectW, tasksW)
  }
  clusters.forEach(cluster => {
    cluster.innerW = cluster.projects.reduce((sum, project) => sum + projectSubW(project), 0)
      + Math.max(0, cluster.projects.length - 1) * siblingGap
    cluster.w = Math.max(identityW, cluster.innerW)
  })
  const contentW = clusters.reduce((sum, cluster) => sum + cluster.w, 0)
    + Math.max(0, clusters.length - 1) * clusterGap

  const goalLane = laneNodes.filter(n => n.lane === 'goal')
  const decisionLane = laneNodes.filter(n => n.lane === 'decision')
  const bandCols = Math.max(1, Math.floor((contentW + goalGapH) / (goalW + goalGapH)))
  const goalCols = Math.min(goalLane.length, bandCols) || 1
  const goalRows = Math.ceil(goalLane.length / goalCols)
  const goalAreaH = goalLane.length > 0 ? labelH + goalRows * (goalH + 6) + 20 : 0

  const identityY = pad.y + goalAreaH
  const projectY = identityY + identityH + levelGap
  const taskY = projectY + projectH + levelGap

  const nodes = []
  const links = []
  const identityColorById = new Map(visibleIdentityNodes.map(identity => [identity.id, identity.color]))

  let cursor = pad.x
  let anyTasks = false
  clusters.forEach(cluster => {
    if (cluster.identity) {
      nodes.push({
        id: `identity:${cluster.identity.id}`,
        type: 'identity',
        name: cluster.identity.name,
        x: cursor + (cluster.w - identityW) / 2,
        y: identityY,
        w: identityW,
        h: identityH,
        color: cluster.identity.color,
        data: { ...cluster.identity, type: 'identity' },
      })
    }
    let projectCursor = cursor + (cluster.w - cluster.innerW) / 2
    cluster.projects.forEach(project => {
      const subW = projectSubW(project)
      nodes.push({
        id: `project:${project.id}`,
        type: 'project',
        name: project.name,
        x: projectCursor + (subW - projectW) / 2,
        y: projectY,
        w: projectW,
        h: projectH,
        color: riskColor(project.risk),
        data: project,
      })
      project.identityIds.forEach(identityId => {
        links.push({
          from: `identity:${identityId}`,
          to: `project:${project.id}`,
          color: identityColorById.get(identityId) || '#64748b',
          type: 'owns',
        })
      })
      const tasks = tasksByProject.get(project.id) || []
      const tasksW = tasks.length > 0 ? tasks.length * taskW + (tasks.length - 1) * siblingGap : 0
      let taskCursor = projectCursor + (subW - tasksW) / 2
      tasks.forEach(task => {
        anyTasks = true
        nodes.push({
          id: `task:${task.id}`,
          type: 'task',
          name: task.name,
          x: taskCursor,
          y: taskY,
          w: taskW,
          h: taskH,
          color: task.color,
          data: task,
        })
        links.push({
          from: `project:${project.id}`,
          to: `task:${task.id}`,
          color: viewMode === 'dependencies' ? '#737373' : riskColor(task.risk),
          type: task.risk,
        })
        taskCursor += taskW + siblingGap
      })
      projectCursor += subW + siblingGap
    })
    cursor += cluster.w + clusterGap
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
  const goalStartX = pad.x + Math.max(0, (contentW - totalGoalW) / 2)
  if (goalLane.length > 0) {
    bands.push({ key: 'goals', x: pad.x, y: pad.y, w: contentW })
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

  const bodyBottom = anyTasks ? taskY + taskH : projectY + projectH
  const decisionTop = bodyBottom + 40 + labelH
  const decisionColCount = Math.min(decisionLane.length, bandCols) || 1
  const totalDecW = decisionColCount * goalW + (decisionColCount - 1) * goalGapH
  const decStartX = pad.x + Math.max(0, (contentW - totalDecW) / 2)
  if (decisionLane.length > 0) {
    bands.push({ key: 'decisions', x: pad.x, y: decisionTop - labelH, w: contentW })
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
  const canvasH = Math.max(520, bodyBottom + 40 + decAreaH + pad.y)

  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const validLinks = links.filter(l => nodeById.has(l.from) && nodeById.has(l.to))
  return {
    nodes,
    links: validLinks,
    nodeById,
    width: contentW + pad.x * 2,
    height: canvasH,
    columns: null,
    bands,
    labelH,
    padY: pad.y,
  }
}

// Vertical beziers for the top-down tree: parent bottom edge to child top
// edge. Dependencies (same-level task links) arc underneath the row.
export function treePath(from, to, linkType) {
  if (linkType === 'dependency') {
    const x1 = from.x + from.w / 2
    const y1 = from.y + from.h
    const x2 = to.x + to.w / 2
    const y2 = to.y + to.h
    const arc = 26 + Math.abs(x2 - x1) * 0.08
    return `M ${x1} ${y1} C ${x1} ${y1 + arc}, ${x2} ${y2 + arc}, ${x2} ${y2}`
  }
  const goDown = (to.y + to.h / 2) > (from.y + from.h / 2)
  const x1 = from.x + from.w / 2
  const y1 = goDown ? from.y + from.h : from.y
  const x2 = to.x + to.w / 2
  const y2 = goDown ? to.y : to.y + to.h
  const bend = Math.max(18, Math.abs(y2 - y1) * 0.45)
  const dir = goDown ? 1 : -1
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${x2} ${y2 - dir * bend}, ${x2} ${y2}`
}
