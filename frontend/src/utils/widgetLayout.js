// Pure logic for the Dashboard's draggable widget columns — framework-free so it can be
// unit-tested without mounting dnd-kit. 'main'/'sidebar' mirror .commandMainColumn and the
// sidebar column in Dashboard.module.css.
export const WIDGET_COLUMN_KEYS = ['main', 'sidebar']

export const DEFAULT_WIDGET_ORDER = {
  main: ['command-hero', 'priority-wall', 'agent-tasks', 'due-soon'],
  sidebar: ['ops-sidebar'],
}

function arrayMove(list, fromIndex, toIndex) {
  const next = list.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

// Keeps a saved order in sync with the widget set the app currently knows about: a widget
// id missing from `saved` (new widget type, or a first run) is appended to 'main'; an id no
// longer in `defaultOrder` (a removed widget type) is dropped rather than kept forever.
export function normalizeWidgetOrder(saved, defaultOrder = DEFAULT_WIDGET_ORDER) {
  const known = new Set(WIDGET_COLUMN_KEYS.flatMap(k => defaultOrder[k]))
  const source = saved && WIDGET_COLUMN_KEYS.every(k => Array.isArray(saved[k])) ? saved : defaultOrder
  const seen = new Set()
  const next = {}
  for (const key of WIDGET_COLUMN_KEYS) {
    next[key] = (source[key] || []).filter(id => known.has(id) && !seen.has(id) && seen.add(id))
  }
  for (const id of known) {
    if (!seen.has(id)) {
      next.main.push(id)
      seen.add(id)
    }
  }
  return next
}

// Given a drag's active/over ids, returns the next order (or the same reference if the
// drop was a no-op). `overId` may name a widget (drop beside it) or a column key itself
// (drop into an empty column, or past the last item).
export function reorderWidgets(order, activeId, overId) {
  if (!overId || activeId === overId) return order

  const findColumn = (id) => WIDGET_COLUMN_KEYS.find(k => order[k].includes(id))
  const isOverAColumn = WIDGET_COLUMN_KEYS.includes(overId)
  const sourceCol = findColumn(activeId)
  const targetCol = isOverAColumn ? overId : findColumn(overId)
  if (!sourceCol || !targetCol) return order

  if (sourceCol === targetCol) {
    if (isOverAColumn) return order
    const list = order[sourceCol]
    const oldIdx = list.indexOf(activeId)
    const newIdx = list.indexOf(overId)
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return order
    return { ...order, [sourceCol]: arrayMove(list, oldIdx, newIdx) }
  }

  const sourceList = order[sourceCol].filter(id => id !== activeId)
  const targetList = order[targetCol].slice()
  const insertAt = isOverAColumn ? targetList.length : targetList.indexOf(overId)
  targetList.splice(insertAt === -1 ? targetList.length : insertAt, 0, activeId)
  return { ...order, [sourceCol]: sourceList, [targetCol]: targetList }
}
