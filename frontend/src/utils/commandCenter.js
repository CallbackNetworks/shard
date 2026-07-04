const CLOSED_STATUSES = new Set(['done', 'failed'])

function toTime(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function taskSortValue(task) {
  const priorityRank = { high: 0, medium: 1, low: 2 }
  const due = toTime(task.due_date)
  return [
    priorityRank[task.priority] ?? 1,
    due ?? Number.MAX_SAFE_INTEGER,
    String(task.title || ''),
  ]
}

function compareTasks(a, b) {
  const av = taskSortValue(a)
  const bv = taskSortValue(b)
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] < bv[i]) return -1
    if (av[i] > bv[i]) return 1
  }
  return 0
}

export function flattenProjectTasks(projects = []) {
  return projects.flatMap(project =>
    (project.tasks || []).map(task => ({
      ...task,
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
    }))
  )
}

export function isOverdue(task, now = new Date()) {
  const due = toTime(task?.due_date)
  if (!due || task?.status === 'done') return false
  return due < now.getTime()
}

export function isDoneToday(task, now = new Date()) {
  if (task?.status !== 'done') return false
  const completed = toTime(task.completed_at) ?? toTime(task.updated_at)
  if (!completed) return false
  return new Date(completed).toDateString() === now.toDateString()
}

export function classifyCommandTask(task, now = new Date()) {
  if (!task) return 'waiting'
  if (task.status === 'done') return isDoneToday(task, now) ? 'doneToday' : 'done'
  if (task.status === 'failed' || isOverdue(task, now) || task.priority === 'high') return 'critical'
  if (task.status === 'in_progress') return 'inMotion'
  return 'waiting'
}

function uniqueById(tasks) {
  const seen = new Set()
  return tasks.filter(task => {
    const key = task.id ?? `${task.projectId}:${task.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function deriveCommandCenter(projects = [], activities = [], goals = [], decisions = [], now = new Date()) {
  const tasks = flattenProjectTasks(projects)
  const activeTasks = tasks.filter(task => !CLOSED_STATUSES.has(task.status))
  const doneTasks = tasks.filter(task => task.status === 'done')
  const failedTasks = tasks.filter(task => task.status === 'failed')
  const overdueTasks = tasks.filter(task => isOverdue(task, now))
  const inMotionTasks = tasks.filter(task => task.status === 'in_progress')
  const completedToday = tasks.filter(task => isDoneToday(task, now))

  const critical = uniqueById([
    ...overdueTasks,
    ...failedTasks,
    ...activeTasks.filter(task => task.priority === 'high'),
  ]).sort((a, b) => {
    if (isOverdue(a, now) && !isOverdue(b, now)) return -1
    if (!isOverdue(a, now) && isOverdue(b, now)) return 1
    if (a.status === 'failed' && b.status !== 'failed') return -1
    if (a.status !== 'failed' && b.status === 'failed') return 1
    return compareTasks(a, b)
  })

  const waiting = tasks
    .filter(task => !CLOSED_STATUSES.has(task.status) && classifyCommandTask(task, now) === 'waiting')
    .sort(compareTasks)

  const doneToday = completedToday.length > 0
    ? completedToday.sort((a, b) => (toTime(b.completed_at) ?? toTime(b.updated_at) ?? 0) - (toTime(a.completed_at) ?? toTime(a.updated_at) ?? 0))
    : doneTasks.slice(-8).reverse()

  const totalTasks = tasks.length
  const completion = totalTasks ? Math.round((doneTasks.length / totalTasks) * 100) : 0
  const latestSignal = activities[0]?.detail || activities[0]?.action || 'SYSTEM READY'
  const activeProjects = projects.filter(project => project.status === 'active')
  const pendingDecisions = decisions.filter(decision => decision.decision_status === 'proposed')
  const activeGoals = goals.filter(goal => !goal.status || ['active', 'in_progress', 'open'].includes(goal.status))

  return {
    metrics: {
      activeTasks: activeTasks.length,
      completion,
      overdue: overdueTasks.length,
      failed: failedTasks.length,
      inMotion: inMotionTasks.length,
      projects: activeProjects.length,
      totalTasks,
      doneTasks: doneTasks.length,
      latestSignal,
    },
    lanes: {
      critical,
      inMotion: inMotionTasks.sort(compareTasks),
      waiting,
      doneToday,
    },
    briefing: {
      activeProjects,
      recentActivity: activities.slice(0, 5),
      activeGoals: activeGoals.slice(0, 4),
      pendingDecisions: pendingDecisions.slice(0, 4),
    },
  }
}
