import { taskWeight } from './structureMapLayout'

const PROJECT_RISK_RANK = { failed: 0, overdue: 1, active: 2, normal: 3 }

function byRisk(a, b) {
  return (
    (PROJECT_RISK_RANK[a.risk] ?? 9) - (PROJECT_RISK_RANK[b.risk] ?? 9) ||
    a.name.localeCompare(b.name)
  )
}

// Groups the structure graph into ownership containers instead of node/link
// pairs: each identity gets a territory holding its exclusive projects, while
// multi-owner and ownerless projects land in dedicated shared/unowned lanes.
export function buildTerritoryModel({ projects = [], identities = [], tasks = [], goals = [], decisions = [] }) {
  const visibleProjectIds = new Set(projects.map(project => project.id))
  const identityIds = new Set(identities.map(identity => identity.id))

  const tasksByProject = new Map()
  const rankedTasks = [...tasks].sort((a, b) => taskWeight(b) - taskWeight(a) || a.name.localeCompare(b.name))
  for (const task of rankedTasks) {
    if (!visibleProjectIds.has(task.projectId)) continue
    if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, [])
    tasksByProject.get(task.projectId).push(task)
  }

  const decisionsByProject = new Map()
  for (const decision of decisions) {
    if (!visibleProjectIds.has(decision.projectId)) continue
    if (!decisionsByProject.has(decision.projectId)) decisionsByProject.set(decision.projectId, [])
    decisionsByProject.get(decision.projectId).push(decision)
  }

  const ownedByIdentity = new Map(identities.map(identity => [identity.id, []]))
  const shared = []
  const unowned = []
  for (const project of projects) {
    const ownerIds = (project.identityIds || []).filter(id => identityIds.has(id))
    if (ownerIds.length === 0) unowned.push(project)
    else if (ownerIds.length === 1) ownedByIdentity.get(ownerIds[0]).push(project)
    else shared.push(project)
  }

  const territories = identities.map(identity => ({
    identity,
    projects: ownedByIdentity.get(identity.id).sort(byRisk),
  }))
  shared.sort(byRisk)
  unowned.sort(byRisk)

  const goalNodes = goals
    .map(goal => ({
      ...goal,
      linkedProjectIds: (goal.projectIds || []).filter(id => visibleProjectIds.has(id)),
    }))
    .sort((a, b) =>
      (b.linkedProjectIds.length > 0) - (a.linkedProjectIds.length > 0) ||
      (b.progress || 0) - (a.progress || 0)
    )

  const projectById = new Map(projects.map(project => [project.id, project]))

  const keys = new Set()
  for (const identity of identities) keys.add(`identity:${identity.id}`)
  for (const project of projects) keys.add(`project:${project.id}`)
  for (const group of tasksByProject.values()) for (const task of group) keys.add(`task:${task.id}`)
  for (const group of decisionsByProject.values()) for (const decision of group) keys.add(`decision:${decision.id}`)
  for (const goal of goalNodes) keys.add(`goal:${goal.id}`)

  return { territories, shared, unowned, tasksByProject, decisionsByProject, goals: goalNodes, projectById, keys }
}

// Resolves which node keys stay lit for the current selection; everything else
// is muted. Chip keys are non-null only when muting must reach inside a card.
export function computeTerritoryHighlight(selected, model, dependencyLinks = []) {
  if (!selected) return null
  const projectIds = new Set()
  const identityIds = new Set()
  const goalIds = new Set()
  let chipKeys = null

  const addProjectOwners = (projectId) => {
    const project = model.projectById.get(projectId)
    for (const id of project?.identityIds || []) identityIds.add(id)
  }
  const addGoalsTouching = () => {
    for (const goal of model.goals) {
      if (goal.linkedProjectIds.some(id => projectIds.has(id))) goalIds.add(goal.id)
    }
  }

  if (selected.type === 'identity') {
    identityIds.add(selected.id)
    for (const [projectId, project] of model.projectById) {
      if ((project.identityIds || []).includes(selected.id)) projectIds.add(projectId)
    }
    addGoalsTouching()
  } else if (selected.type === 'project') {
    projectIds.add(selected.id)
    addProjectOwners(selected.id)
    addGoalsTouching()
  } else if (selected.type === 'goal') {
    goalIds.add(selected.id)
    const goal = model.goals.find(item => item.id === selected.id)
    for (const projectId of goal?.linkedProjectIds || []) {
      projectIds.add(projectId)
      addProjectOwners(projectId)
    }
  } else if (selected.type === 'decision') {
    chipKeys = new Set([`decision:${selected.id}`])
    if (selected.projectId) {
      projectIds.add(selected.projectId)
      addProjectOwners(selected.projectId)
    }
  } else if (selected.type === 'task') {
    const selfKey = `task:${selected.id}`
    chipKeys = new Set([selfKey])
    for (const link of dependencyLinks) {
      if (link.from === selfKey) chipKeys.add(link.to)
      if (link.to === selfKey) chipKeys.add(link.from)
    }
    for (const [projectId, group] of model.tasksByProject) {
      if (group.some(task => chipKeys.has(`task:${task.id}`))) {
        projectIds.add(projectId)
        addProjectOwners(projectId)
      }
    }
  }

  return { projectIds, identityIds, goalIds, chipKeys }
}
