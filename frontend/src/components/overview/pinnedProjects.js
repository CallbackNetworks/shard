/** localStorage-backed pinned-project ids for the overview cards (max 3). */

const PINNED_KEY = 'overview_pinned_projects'

export function getPinnedIds() {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) || '[]') } catch { return [] }
}

export function togglePin(projectId) {
  const ids = getPinnedIds()
  const next = ids.includes(projectId) ? ids.filter(id => id !== projectId) : [...ids, projectId].slice(-3)
  localStorage.setItem(PINNED_KEY, JSON.stringify(next))
  return next
}
