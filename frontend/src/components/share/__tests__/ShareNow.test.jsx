import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ShareNow from '../ShareNow'
import ShareMarquee from '../ShareMarquee'

// jsdom has no ResizeObserver; the marquee measures its own loop width with one.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString()
const task = (id, status, extra = {}) => ({ id, title: id, status, subtasks: [], subtask_count: 0, ...extra })

describe('ShareNow', () => {
  it('lists work in progress across projects, late work first', () => {
    render(<ShareNow
      projects={[
        { id: 'p1', name: 'Alpha', tasks: [task('later', 'in_progress', { due_date: day(5) }), task('finished', 'done')] },
        { id: 'p2', name: 'Beta', tasks: [task('late', 'in_progress', { due_date: day(-2) })] },
      ]}
    />)
    const rows = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(rows[0]).toContain('late')
    expect(rows[1]).toContain('later')
    expect(screen.queryByText('finished')).toBeNull()
  })

  it('draws one status bar per project with its done count', () => {
    render(<ShareNow
      projects={[{ id: 'p1', name: 'Alpha', tasks: [task('a', 'done'), task('b', 'todo'), task('c', 'in_progress')] }]}
    />)
    expect(screen.getByLabelText('1 done, 1 active, 0 failed, 1 todo')).toBeTruthy()
    expect(screen.getByText('1/3')).toBeTruthy()
  })
})

describe('ShareMarquee', () => {
  it('scrolls what people did, not what the system did', () => {
    render(<ShareMarquee activity={[
      { action: 'share.viewed', detail: 'someone looked', created_at: day(0) },
      { action: 'task.sla_escalated', detail: 'Task stuck for 98 days', created_at: day(0) },
      { action: 'rule.executed', detail: 'Rule fired', created_at: day(0) },
      { action: 'task.done', detail: 'Shipped the icon', created_at: day(0) },
      { action: 'decision.accepted', detail: 'Use PostgreSQL', created_at: day(0) },
    ]} />)
    expect(screen.getAllByText('Shipped the icon').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Use PostgreSQL').length).toBeGreaterThan(0)
    for (const noise of ['someone looked', 'Task stuck for 98 days', 'Rule fired']) {
      expect(screen.queryByText(noise)).toBeNull()
    }
  })

  it('falls back to the fixed label when there is nothing to say', () => {
    render(<ShareMarquee />)
    expect(screen.getAllByText('SHARED STATUS').length).toBeGreaterThan(0)
  })
})
