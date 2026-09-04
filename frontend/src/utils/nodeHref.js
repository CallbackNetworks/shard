import { hasNodeRole } from '../constants/nodeRoles'

// One rule for "where does this node open" (ADR-0094). Entity types with a richer
// dedicated page keep it; container-role types get the container view; everything
// else lands on the universal node page. It lives here rather than in NodePage
// because the ancestry strip links the same nodes from every page.
export function nodeHref(ref, typeByKey) {
  if (!ref) return '/'
  if (ref.type === 'project') return `/projects/${ref.id}`
  if (hasNodeRole(typeByKey?.get(ref.type), 'container')) return `/c/${ref.id}`
  return `/n/${ref.id}`
}

/**
 * Where a *task* opens (ADR-0147).
 *
 * A task is a node, so `nodeHref` would send it to `/n/{id}` — which is a real page
 * and the wrong one: it strips the board, the sibling work and the cycle the task was
 * being read in the context of. A task opens in its project with the row picked out,
 * which is what `?focus=` means to `ProjectDetail`. Without a project (an orphan, or
 * a caller that only had the id) the universal node page is still better than nothing.
 *
 * Both key spellings are accepted because the Overview's own shapes disagree:
 * `flattenProjectTasks` writes `projectId`, the API writes `project_id`, and a caller
 * silently getting `undefined` builds `/projects/undefined?focus=…` — a URL that
 * routes, renders "project not found", and looks like a backend fault.
 */
export function taskHref(task) {
  if (!task?.id) return null
  const projectId = task.projectId ?? task.project_id
  return projectId ? `/projects/${projectId}?focus=${task.id}` : `/n/${task.id}`
}

/**
 * Where an activity row opens (ADR-0147).
 *
 * `ActivityLogOut` already carries `task_id`, `project_id` and the resolved
 * `node_type`, so the feed has always known what each line happened to — it just
 * never offered a way to get there. `task_id` names a node of *any* type (ADR-0090:
 * a task-like custom type is a task), so the type decides between the project row
 * and the node page rather than the column name.
 *
 * Returns null when the row names nothing reachable — a caller must render a plain
 * row then, not a button that goes nowhere.
 */
export function activityHref(activity, typeByKey) {
  if (!activity) return null
  const subject = activity.task_id
  if (subject) {
    const type = activity.node_type
    // A node id in `task_id` that is not task-like belongs on its own page.
    if (type && type !== 'task' && !hasNodeRole(typeByKey?.get(type), 'task')) {
      return nodeHref({ id: subject, type }, typeByKey)
    }
    return taskHref({ id: subject, project_id: activity.project_id })
  }
  if (activity.project_id) return `/projects/${activity.project_id}`
  return null
}
