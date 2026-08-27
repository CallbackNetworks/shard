import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TaskFiltersPanel from '../TaskFiltersPanel'
import { qk } from '../../../api/queryKeys'

/**
 * A saved view is written in one shape and read back in another — the stored
 * filters say `label_id` where the URL says `label`, and an axis at "all" is
 * stored as absent but restored as "all". Both halves live here now, and this
 * asserts they are inverses: what a save writes is what an apply puts back.
 */

const mocks = vi.hoisted(() => ({
  getSavedFilters: vi.fn(),
  createSavedFilter: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('../../../api/client', () => mocks)

const ALL = { status: 'all', priority: 'all', label: 'all', assignee: 'all', due: 'all', agent: 'all' }

let qc
let invalidateSpy
let setFilters
let setShowFilters

function renderPanel(filters = ALL, activeFilterCount = 0) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
  setFilters = vi.fn()
  setShowFilters = vi.fn()
  return render(
    <QueryClientProvider client={qc}>
      <TaskFiltersPanel
        projectId="p1"
        filters={filters}
        setFilters={setFilters}
        searchQ=""
        setSearchQ={() => {}}
        showFilters={false}
        setShowFilters={setShowFilters}
        activeFilterCount={activeFilterCount}
        topTasks={[]}
        labels={[]}
        assignees={[]}
        agentNames={[]}
        bulkMode={false}
        onToggleBulk={() => {}}
        onExport={() => {}}
        showImport={false}
        onToggleImport={() => {}}
      />
    </QueryClientProvider>
  )
}

describe('TaskFiltersPanel saved views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSavedFilters.mockResolvedValue([])
    mocks.createSavedFilter.mockResolvedValue({ id: 'sf1' })
  })

  it('stores only the axes that are actually filtering, under the stored names', async () => {
    renderPanel({ ...ALL, status: 'todo', label: 'l1', agent: 'ci' }, 2)
    fireEvent.click(screen.getByTitle('project.saveView'))
    fireEvent.change(screen.getByLabelText('project.viewName'), { target: { value: 'My view' } })
    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(mocks.createSavedFilter).toHaveBeenCalledWith({
      name: 'My view',
      project_id: 'p1',
      filters: {
        status: 'todo',
        priority: undefined,
        // The URL calls this `label`; the stored view calls it `label_id`.
        label_id: 'l1',
        assignee: undefined,
        due: undefined,
        agent: 'ci',
      },
    }))
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
      expect(keys).toContain(JSON.stringify(qk.savedFilters('p1')))
    })
  })

  it('refuses a blank name', () => {
    renderPanel({ ...ALL, status: 'todo' }, 1)
    fireEvent.click(screen.getByTitle('project.saveView'))
    fireEvent.change(screen.getByLabelText('project.viewName'), { target: { value: '   ' } })
    expect(screen.getByText('save')).toBeDisabled()
  })

  it('applying a view replaces every axis, including the ones it left empty', async () => {
    mocks.getSavedFilters.mockResolvedValue([
      { id: 'sf1', name: 'Blocked work', filters: { status: 'blocked', label_id: 'l9' } },
    ])
    renderPanel({ ...ALL, priority: 'high', assignee: 'me' }, 2)

    await screen.findByText('Blocked work')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sf1' } })

    // priority and assignee were set and the view does not mention them, so they
    // are reset rather than carried over — applying a view is a replacement.
    expect(setFilters).toHaveBeenCalledWith({
      status: 'blocked',
      priority: 'all',
      label: 'l9',
      assignee: 'all',
      due: 'all',
      agent: 'all',
    })
    expect(setShowFilters).toHaveBeenCalledWith(true)
  })

  it('ignores a selection that names no view', async () => {
    mocks.getSavedFilters.mockResolvedValue([{ id: 'sf1', name: 'Blocked work', filters: {} }])
    renderPanel()
    await screen.findByText('Blocked work')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(setFilters).not.toHaveBeenCalled()
  })
})
