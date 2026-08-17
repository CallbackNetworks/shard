import { STATUS_COLOR } from '../constants/theme'
import { isOverdue } from '../utils/overdue'

export function taskRisk(task, now = new Date()) {
  const overdue = isOverdue(task, now)
  if (task.status === 'failed') return 'failed'
  if (overdue) return 'overdue'
  if (task.priority === 'high' || task.is_pinned) return 'priority'
  if (task.status === 'in_progress') return 'active'
  return 'normal'
}

export function dependencyNeighborhood(taskId, links = [], limit = 14) {
  if (!taskId) return []
  const startKey = `task:${taskId}`
  const seen = new Set([startKey])
  const queue = [startKey]

  while (queue.length && seen.size < limit) {
    const key = queue.shift()
    for (const link of links) {
      if (link.type !== 'dependency') continue
      if (link.from !== key && link.to !== key) continue
      const next = link.from === key ? link.to : link.from
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
      if (seen.size >= limit) break
    }
  }

  return Array.from(seen).map(key => key.replace('task:', ''))
}

export function deriveStructureMap(projects = [], identities = [], goals = [], decisions = [], now = new Date()) {
  const taskProjectById = new Map()
  const blockingByTaskId = new Map()

  for (const project of projects) {
    for (const task of project.tasks || []) {
      taskProjectById.set(task.id, project.id)
    }
  }
  for (const project of projects) {
    for (const task of project.tasks || []) {
      for (const blockerId of task.blocked_by || []) {
        if (!blockingByTaskId.has(blockerId)) blockingByTaskId.set(blockerId, [])
        blockingByTaskId.get(blockerId).push(task.id)
      }
    }
  }

  const projectNodes = projects.map(project => {
    const tasks = project.tasks || []
    const failed = tasks.filter(task => task.status === 'failed').length
    const overdue = tasks.filter(task => taskRisk(task, now) === 'overdue').length
    const inProgress = tasks.filter(task => task.status === 'in_progress').length
    const risk = failed > 0 ? 'failed' : overdue > 0 ? 'overdue' : inProgress > 0 ? 'active' : 'normal'
    return {
      id: project.id,
      type: 'project',
      name: project.name,
      status: project.status,
      progress: Math.round(project.progress || 0),
      totalTasks: project.total_tasks ?? tasks.length,
      doneTasks: project.done_tasks ?? tasks.filter(task => task.status === 'done').length,
      failed,
      overdue,
      inProgress,
      dependencyCount: tasks.reduce((total, task) => total + (task.blocked_by || []).length, 0),
      decisionCount: decisions.filter(decision => decision.project_id === project.id).length,
      pendingDecisionCount: decisions.filter(decision => decision.project_id === project.id && decision.decision_status === 'proposed').length,
      identityIds: (project.identities || []).map(identity => identity.id),
      risk,
    }
  })

  const projectById = new Map(projectNodes.map(project => [project.id, project]))
  const identityNodes = identities.map(identity => {
    const linked = projects.filter(project => (project.identities || []).some(item => item.id === identity.id))
    return {
      id: identity.id,
      type: 'identity',
      name: identity.name,
      avatar: identity.avatar,
      color: identity.color || '#facc15',
      projectCount: linked.length,
      projectIds: linked.map(project => project.id),
      shareActive: Boolean(identity.share_pin_set || identity.share_token),
    }
  })

  const allTaskNodes = []
  for (const project of projects) {
    for (const task of project.tasks || []) {
      if (task.parent_id) continue
      const risk = taskRisk(task, now)
      const blockedBy = (task.blocked_by || []).filter(taskId => taskProjectById.has(taskId))
      const blocking = blockingByTaskId.get(task.id) || []
      const signal = risk !== 'normal' || task.status !== 'todo' || task.priority === 'high'
      allTaskNodes.push({
        id: task.id,
        type: 'task',
        projectId: project.id,
        name: task.title,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee,
        risk,
        signal,
        blockedBy,
        blocking,
        color: STATUS_COLOR[task.status] || STATUS_COLOR.todo,
      })
    }
  }
  const taskNodes = allTaskNodes.filter(task => task.signal)
  const dependencyTaskNodes = allTaskNodes.filter(task => task.signal || task.blockedBy.length > 0 || task.blocking.length > 0)

  const goalNodes = goals.map(goal => ({
    id: goal.id,
    type: 'goal',
    name: goal.title,
    status: goal.status,
    progress: Math.round(goal.progress || 0),
    projectIds: (goal.projects || []).map(project => project.project_id),
  }))

  const decisionNodes = decisions.map(decision => ({
    id: decision.id,
    type: 'decision',
    name: decision.name,
    status: decision.decision_status || 'proposed',
    projectId: decision.project_id,
  }))

  const links = []
  for (const project of projects) {
    for (const identity of project.identities || []) {
      links.push({ from: `identity:${identity.id}`, to: `project:${project.id}`, type: 'owns' })
    }
  }
  for (const task of taskNodes) {
    links.push({ from: `project:${task.projectId}`, to: `task:${task.id}`, type: task.risk })
  }
  for (const goal of goalNodes) {
    for (const projectId of goal.projectIds) {
      if (projectById.has(projectId)) links.push({ from: `goal:${goal.id}`, to: `project:${projectId}`, type: 'goal' })
    }
  }
  for (const decision of decisionNodes) {
    if (projectById.has(decision.projectId)) {
      links.push({ from: `decision:${decision.id}`, to: `project:${decision.projectId}`, type: decision.status })
    }
  }

  const dependencyLinks = []
  const dependencyTaskIds = new Set(dependencyTaskNodes.map(task => task.id))
  for (const task of dependencyTaskNodes) {
    for (const blockerId of task.blockedBy) {
      if (dependencyTaskIds.has(blockerId)) {
        dependencyLinks.push({
          from: `task:${blockerId}`,
          to: `task:${task.id}`,
          type: 'dependency',
          projectId: task.projectId,
        })
      }
    }
  }

  const unownedProjects = projectNodes.filter(project => project.identityIds.length === 0)
  const stats = {
    identities: identityNodes.length,
    projects: projectNodes.length,
    tasks: taskNodes.length,
    goals: goalNodes.length,
    decisions: decisionNodes.length,
    failedProjects: projectNodes.filter(project => project.failed > 0).length,
    overdueProjects: projectNodes.filter(project => project.overdue > 0).length,
    unownedProjects: unownedProjects.length,
    dependencies: dependencyLinks.length,
  }

  return { identityNodes, projectNodes, taskNodes, dependencyTaskNodes, goalNodes, decisionNodes, links, dependencyLinks, stats }
}
