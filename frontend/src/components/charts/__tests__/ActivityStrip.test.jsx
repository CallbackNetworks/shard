import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ActivityStrip, { streak, stripWeeks } from '../ActivityStrip'
import StatusFlow from '../StatusFlow'

const TODAY = new Date('2026-11-19T12:00:00Z')
const day = n => new Date(TODAY.getTime() - n * 86400000).toISOString().slice(0, 10)

describe('stripWeeks', () => {
  it('draws a whole year when the width allows small cells', () => {
    expect(stripWeeks(720, TODAY).weeks).toBeGreaterThanOrEqual(53)
  })

  it('shows fewer, recent weeks on a narrow screen instead of shrinking cells away', () => {
    const { weeks, end } = stripWeeks(380, TODAY)
    expect(weeks).toBeLessThan(40)
    expect(weeks).toBeGreaterThanOrEqual(13)
    expect(end.toISOString().slice(0, 10)).toBe('2026-11-19')
  })
})

describe('streak', () => {
  const counts = new Map([[day(0), 1], [day(1), 2], [day(2), 1], [day(4), 5]])
  it('counts consecutive active days back from today', () => {
    expect(streak(counts, new Date(`${day(0)}T00:00:00Z`))).toBe(3)
  })
  it('still counts when today is quiet so far', () => {
    expect(streak(new Map([[day(1), 1], [day(2), 1]]), new Date(`${day(0)}T00:00:00Z`))).toBe(2)
  })
})

describe('ActivityStrip', () => {
  it('reads the total out', () => {
    render(<ActivityStrip data={[{ date: day(1), count: 4 }, { date: day(2), count: 3 }]} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/^7 UPDATES/)
  })
})

describe('StatusFlow', () => {
  const trend = [
    { date: day(2), todo: 5, in_progress: 1, done: 2, failed: 0 },
    { date: day(1), todo: 4, in_progress: 2, done: 3, failed: 0 },
    { date: day(0), todo: 3, in_progress: 2, done: 5, failed: 1 },
  ]

  it('reads out each status as it stands now', () => {
    render(<StatusFlow data={trend} />)
    expect(screen.getByRole('img', { name: 'TODO 3, IN PROGRESS 2, FAILED 1, DONE 5' })).toBeTruthy()
  })

  it('draws nothing for a single day', () => {
    const { container } = render(<StatusFlow data={trend.slice(0, 1)} />)
    expect(container.firstChild).toBeNull()
  })
})
