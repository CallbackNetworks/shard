import { describe, it, expect } from 'vitest'
import { DEFAULT_WIDGET_ORDER, normalizeWidgetOrder, reorderWidgets } from '../widgetLayout'

describe('normalizeWidgetOrder', () => {
  it('returns the default order unchanged when nothing is saved', () => {
    expect(normalizeWidgetOrder(null)).toEqual(DEFAULT_WIDGET_ORDER)
  })

  it('keeps a saved order that already covers every known widget', () => {
    const saved = { main: ['priority-wall', 'command-hero'], sidebar: ['ops-sidebar', 'agent-tasks', 'due-soon'] }
    expect(normalizeWidgetOrder(saved)).toEqual(saved)
  })

  it('appends a widget missing from the saved order to main', () => {
    const saved = { main: ['command-hero'], sidebar: ['ops-sidebar'] }
    const next = normalizeWidgetOrder(saved)
    expect(next.main).toEqual(['command-hero', 'priority-wall', 'agent-tasks', 'due-soon'])
    expect(next.sidebar).toEqual(['ops-sidebar'])
  })

  it('drops a stale id no longer in the default set', () => {
    const saved = { main: ['command-hero', 'ghost-widget'], sidebar: ['ops-sidebar'] }
    const next = normalizeWidgetOrder(saved)
    expect(next.main).not.toContain('ghost-widget')
  })

  it('falls back to defaults when the saved shape is malformed', () => {
    expect(normalizeWidgetOrder({ main: 'not-an-array' })).toEqual(DEFAULT_WIDGET_ORDER)
  })
})

describe('reorderWidgets', () => {
  const order = {
    main: ['command-hero', 'priority-wall', 'agent-tasks', 'due-soon'],
    sidebar: ['ops-sidebar'],
  }

  it('is a no-op when dropped on itself', () => {
    expect(reorderWidgets(order, 'command-hero', 'command-hero')).toBe(order)
  })

  it('is a no-op when there is no drop target', () => {
    expect(reorderWidgets(order, 'command-hero', null)).toBe(order)
  })

  it('reorders within the same column when dropped on another widget', () => {
    const next = reorderWidgets(order, 'due-soon', 'command-hero')
    expect(next.main).toEqual(['due-soon', 'command-hero', 'priority-wall', 'agent-tasks'])
    expect(next.sidebar).toEqual(order.sidebar)
  })

  it('is a no-op when dropped on the same column it is already in (not on a widget)', () => {
    expect(reorderWidgets(order, 'command-hero', 'main')).toBe(order)
  })

  it('moves a widget to another column, inserted before the widget dropped on', () => {
    const next = reorderWidgets(order, 'agent-tasks', 'ops-sidebar')
    expect(next.main).toEqual(['command-hero', 'priority-wall', 'due-soon'])
    expect(next.sidebar).toEqual(['agent-tasks', 'ops-sidebar'])
  })

  it('appends to the end when dropped on the column itself rather than a widget', () => {
    const next = reorderWidgets(order, 'command-hero', 'sidebar')
    expect(next.main).toEqual(['priority-wall', 'agent-tasks', 'due-soon'])
    expect(next.sidebar).toEqual(['ops-sidebar', 'command-hero'])
  })

  it('returns the same reference when either id is unknown', () => {
    expect(reorderWidgets(order, 'not-a-widget', 'command-hero')).toBe(order)
    expect(reorderWidgets(order, 'command-hero', 'not-a-widget')).toBe(order)
  })
})
