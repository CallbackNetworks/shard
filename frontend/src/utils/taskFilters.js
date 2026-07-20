// Pure task-list filtering shared by ProjectDetail. Each dimension uses 'all'
// as the no-op sentinel, mirroring the filter controls; 'due' is a keyword
// ('overdue' | 'this_week' | 'no_date') rather than an exact match.
export function filterTasks(list, filters = {}) {
  const {
    status = 'all',
    priority = 'all',
    label = 'all',
    assignee = 'all',
    agent = 'all',
    due = 'all',
  } = filters

  let result = list
  if (status !== 'all') result = result.filter(t => t.status === status)
  if (priority !== 'all') result = result.filter(t => t.priority === priority)
  if (label !== 'all') result = result.filter(t => (t.labels || []).some(l => l.id === label))
  if (assignee !== 'all') result = result.filter(t => t.assignee === assignee)
  if (agent !== 'all') result = result.filter(t => t.assigned_agent_name === agent)
  if (due === 'overdue') {
    result = result.filter(t => t.due_date && new Date(t.due_date) < new Date())
  } else if (due === 'this_week') {
    const now = new Date()
    const end = new Date()
    end.setDate(now.getDate() + 7)
    result = result.filter(t => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= end)
  } else if (due === 'no_date') {
    result = result.filter(t => !t.due_date)
  }
  return result
}
