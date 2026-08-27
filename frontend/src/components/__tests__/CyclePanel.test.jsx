import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CyclePanel from '../CyclePanel'
import { qk } from '../../api/queryKeys'

/**
 * The five cycle writes used to live in `ProjectDetail` and arrive here as props,
 * and `ProjectDetail`'s own test mocks this component out — so moving them in
 * would have left them with no test at all. Each one is checked for the pair that
 * can silently go wrong when a write moves: the arguments it sends (the project id
 * is now read from a prop, not closed over by the page) and the invalidation that
 * makes the new state appear (cycles ride inside the project payload, and the
 * project list shows cycle counts, so both keys have to be dropped).
 */

const mocks = vi.hoisted(() => ({
  createCycle: vi.fn(),
  updateCycle: vi.fn(),
  deleteCycle: vi.fn(),
  addTaskToCycle: vi.fn(),
  removeTaskFromCycle: vi.fn(),
  duplicateCycle: vi.fn(),
  compareCycles: vi.fn(),
  getCycleBurndown: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../api/client', () => mocks)

const CYCLE = {
  id: 'c1',
  name: 'Sprint 1',
  description: '',
  status: 'draft',
  start_date: null,
  end_date: null,
  task_ids: ['t1'],
  total_tasks: 1,
  done_tasks: 0,
}

const TASKS = [
  { id: 't1', title: 'Write docs', status: 'todo' },
  { id: 't2', title: 'Ship it', status: 'todo' },
]

let qc
let invalidateSpy

function renderPanel(cycles = [CYCLE]) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  return render(
    <QueryClientProvider client={qc}>
      <CyclePanel cycles={cycles} tasks={TASKS} projectId="p1" />
    </QueryClientProvider>
  )
}

// Both keys, every time: the project payload carries the cycles and the project
// list carries their counts.
async function expectRefreshed() {
  await waitFor(() => {
    const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
    expect(keys).toContain(JSON.stringify(qk.project('p1')))
    expect(keys).toContain(JSON.stringify(qk.projects()))
  })
}

describe('CyclePanel owns the cycle writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.values(mocks).forEach(fn => fn.mockResolvedValue({}))
  })

  it('creates a cycle on the panel projectId, dropping the fields left blank', async () => {
    renderPanel([])
    fireEvent.click(screen.getByText('cycle.new'))
    fireEvent.change(screen.getByPlaceholderText('cycle.namePlaceholder'), { target: { value: 'Q4' } })
    fireEvent.click(screen.getByText('create'))

    await waitFor(() => expect(mocks.createCycle).toHaveBeenCalledWith('p1', { name: 'Q4', status: 'draft' }))
    await expectRefreshed()
    // The form closes and empties itself, so the next cycle does not start as a
    // copy of the last one.
    await waitFor(() => expect(screen.queryByPlaceholderText('cycle.namePlaceholder')).toBeNull())
  })

  it('will not create a nameless cycle', () => {
    renderPanel([])
    fireEvent.click(screen.getByText('cycle.new'))
    fireEvent.click(screen.getByText('create'))
    expect(mocks.createCycle).not.toHaveBeenCalled()
  })

  it('updates a cycle', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('edit'))
    fireEvent.change(screen.getByDisplayValue('Sprint 1'), { target: { value: 'Sprint 2' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(mocks.updateCycle).toHaveBeenCalledWith('p1', 'c1', { name: 'Sprint 2', status: 'draft' }))
    await expectRefreshed()
  })

  it('deletes a cycle only after the confirmation', async () => {
    renderPanel()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('delete'))
    expect(mocks.deleteCycle).not.toHaveBeenCalled()

    window.confirm.mockReturnValue(true)
    fireEvent.click(screen.getByText('delete'))
    await waitFor(() => expect(mocks.deleteCycle).toHaveBeenCalledWith('p1', 'c1'))
    await expectRefreshed()
  })

  it('adds a task to a cycle', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('cycle.addIssues'))
    fireEvent.click(screen.getByText('Ship it'))

    await waitFor(() => expect(mocks.addTaskToCycle).toHaveBeenCalledWith('p1', 'c1', 't2'))
    await expectRefreshed()
  })

  it('removes a task from a cycle', async () => {
    renderPanel()
    const row = screen.getByText('Write docs').parentElement
    fireEvent.click(within(row).getByRole('button'))

    await waitFor(() => expect(mocks.removeTaskFromCycle).toHaveBeenCalledWith('p1', 'c1', 't1'))
    await expectRefreshed()
  })

  it('refreshes after a duplicate, which calls the API directly rather than through a mutation', async () => {
    renderPanel()
    fireEvent.click(screen.getByTitle('cycle.duplicateAsTemplate'))
    await waitFor(() => expect(mocks.duplicateCycle).toHaveBeenCalledWith('p1', 'c1'))
    await expectRefreshed()
  })
})
