// Parent/child among a list of tasks (ADR-0094).
//
// The board, the timeline and the calendar used to drop every subtask with a bare
// `parent_id == null` filter, so a project whose work is organised under one parent task
// showed a single card and hid the ten real pieces. Subtasks are shown now, and each of
// these helpers exists so that "which task is this one under" is answered the same way
// everywhere instead of being re-derived per view.
//
// Parenting resolves within the *visible* set, the same rule the container forest uses
// (ADR-0069): if a filter removed the parent, its children are promoted to top level
// rather than disappearing with it.

export function parentIndex(tasks) {
  const byId = new Map((tasks || []).map(t => [t.id, t]))
  const index = new Map()
  for (const task of tasks || []) {
    index.set(task.id, (task.parent_id && byId.get(task.parent_id)) || null)
  }
  return index
}

/** Flatten to `[{ task, depth, parent }]` with each parent immediately followed by its children. */
export function orderTasksByParent(tasks) {
  const list = tasks || []
  const parents = parentIndex(list)
  const childrenOf = new Map()
  const roots = []
  for (const task of list) {
    const parent = parents.get(task.id)
    if (!parent) {
      roots.push(task)
      continue
    }
    if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, [])
    childrenOf.get(parent.id).push(task)
  }
  const out = []
  const seen = new Set()
  const push = (task, depth, parent) => {
    if (seen.has(task.id)) return // defensive: a cycle would otherwise hang the render
    seen.add(task.id)
    out.push({ task, depth, parent })
    for (const child of childrenOf.get(task.id) || []) push(child, depth + 1, task)
  }
  for (const root of roots) push(root, 0, null)
  // A subtask whose parent is present but unreachable from any root (both filtered in a
  // way that broke the chain) still belongs on screen.
  for (const task of list) if (!seen.has(task.id)) push(task, 0, null)
  return out
}

/**
 * Does `rootId`'s subtree contain `targetId`? (ADR-0147)
 *
 * A deep link can name a subtask, and `IssueRow` renders its children only while
 * expanded — so the row the link points at is genuinely not in the document, and
 * the scroll would find nothing and quietly give up. The row asks this on mount to
 * decide its own initial expansion, which is why it takes ids rather than tasks:
 * the caller has a `focus` param, not a task object.
 *
 * Walks parent-upward from the target rather than child-downward from the root:
 * a `parent_id` chain is one lookup per level, and it terminates on a cycle by
 * counting rather than by trusting the data.
 */
export function subtreeContains(tasks, rootId, targetId) {
  if (!rootId || !targetId) return false
  if (rootId === targetId) return true
  const byId = new Map((tasks || []).map(t => [t.id, t]))
  let node = byId.get(targetId)
  let hops = 0
  while (node?.parent_id && hops < 64) {
    if (node.parent_id === rootId) return true
    node = byId.get(node.parent_id)
    hops += 1
  }
  return false
}
