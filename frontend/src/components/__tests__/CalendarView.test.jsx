/**
 * Drag-to-reschedule on the calendar never worked.
 *
 * The drop handler ran `parseInt(dataTransfer.getData('text/plain'), 10)` on a
 * task id — but ids are UUID strings (`models.py`: `String(36)`). A UUID
 * starting with a letter parsed to NaN and the handler bailed silently; one
 * starting with a digit parsed to a truncated number and PATCHed an id that
 * does not exist. Neither outcome moved the task, and neither said so.
 *
 * The click handler had the mirror problem: it fired `onUpdateTask(id, {})`,
 * an empty PATCH that cost a request and a full refetch to change nothing.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../utils/uiPrefs', () => ({
  useUiPrefs: () => ({ weekStart: 'sunday' }),
}))

import CalendarView from '../CalendarView'

// A realistic id: a UUID, and one that begins with a digit so the old
// parseInt path would have produced a plausible-looking wrong number.
const TASK_ID = '7f3a1c22-9b41-4de1-8f0a-2c5d6e7a8b90'

// The task has to fall inside the month the calendar opens on, and `CalendarView`
// opens on `new Date()` — it takes no month prop. With a hardcoded due date that is
// a test which passes until the calendar turns the page: this file was green for
// three weeks and failed on 1 September, on a card that had stopped being rendered
// at all. So the clock is pinned, and the due date is stated relative to it.
const NOW = new Date('2026-08-10T12:00:00')

const TASKS = [
  { id: TASK_ID, title: 'Write the migration', status: 'todo', priority: 'high', due_date: '2026-08-10T00:00:00' },
]

function dropOnSomeDay(onUpdateTask) {
  render(<CalendarView tasks={TASKS} onUpdateTask={onUpdateTask} projectId="p1" />)

  const card = screen.getByTitle('Write the migration')
  const payload = { 'text/plain': TASK_ID }
  const dataTransfer = {
    setData: (type, value) => { payload[type] = value },
    getData: (type) => payload[type],
    // jsdom does not implement these; the handler sets them.
    set effectAllowed(_v) {},
    set dropEffect(_v) {},
  }

  fireEvent.dragStart(card, { dataTransfer })
  // The day cell is the card's grid ancestor; dropping anywhere in the month
  // is enough — the assertion is about the id, not which date won.
  const dayCell = card.closest('div[style*="min-height"]') || card.parentElement.parentElement
  fireEvent.drop(dayCell, { dataTransfer })
}

describe('CalendarView drag-to-reschedule', () => {
  let onUpdateTask

  beforeEach(() => {
    // Only `Date` is faked: the timers testing-library uses to settle the DOM stay
    // real, so pinning the calendar's month does not also stop them.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onUpdateTask = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reschedules using the task id as given, not a parsed number', () => {
    dropOnSomeDay(onUpdateTask)

    expect(onUpdateTask).toHaveBeenCalledTimes(1)
    const [id, patch] = onUpdateTask.mock.calls[0]
    expect(id).toBe(TASK_ID)
    expect(typeof id).toBe('string')
    expect(patch.due_date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not fire an empty update when a task is clicked', () => {
    render(<CalendarView tasks={TASKS} onUpdateTask={onUpdateTask} projectId="p1" />)

    fireEvent.click(screen.getByTitle('Write the migration'))

    expect(onUpdateTask).not.toHaveBeenCalled()
  })
})
