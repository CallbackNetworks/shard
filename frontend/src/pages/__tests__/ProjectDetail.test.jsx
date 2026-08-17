/**
 * A filter narrows the project's tasks, not one view of them — and which view
 * you are on is part of where you are, so it lives in the URL.
 *
 * Before this, only the Issues tab received the filtered list: Board, Timeline,
 * Calendar and Table were all handed the raw `tasks` array, and the filter strip
 * itself was rendered inside the Issues branch. So switching view silently
 * widened what you were looking at and removed the control that would have told
 * you. Separately, nothing was in the URL (`useSearchParams` appeared zero times
 * in the codebase), so a reload, a Back, or a shared link lost the view and every
 * filter with it.
 *
 * The views are stubbed to report the ids they were given: the claim under test
 * is which tasks reach them, not how they draw them.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'

// Resolve real English rather than echoing the key, so these assertions keep
// describing what a user sees (ADR-0088).
vi.mock('react-i18next', async () => (await import('../../test/i18nMock')).reactI18nextMock())

vi.mock('../../hooks/useBreakpoint', () => ({ default: () => 'desktop' }))
vi.mock('../../utils/uiPrefs', () => ({
  getUiPrefs: () => ({ defaultView: 'issues', defaultPriority: 'medium' }),
  useUiPrefs: () => ({}),
}))
vi.mock('../../utils/recentProjects', () => ({ touchProject: vi.fn() }))

const TASKS = [
  { id: 'a', title: 'Alpha task', status: 'todo', priority: 'high', parent_id: null },
  { id: 'b', title: 'Beta task', status: 'done', priority: 'low', parent_id: null },
  { id: 'c', title: 'Gamma task', status: 'todo', priority: 'low', parent_id: null },
]

const PROJECT = {
  id: 'p1', name: 'Test Project', status: 'active',
  tasks: TASKS, labels: [], cycles: [], wip_limits: {},
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) =>
    queryKey[0] === 'project' ? { data: PROJECT, isLoading: false } : { data: [] },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../api/client', () => ({
  getProject: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(),
  updateProject: vi.fn(), createLabel: vi.fn(), deleteLabel: vi.fn(), addLabelToTask: vi.fn(),
  createCycle: vi.fn(), updateCycle: vi.fn(), deleteCycle: vi.fn(),
  addTaskToCycle: vi.fn(), removeTaskFromCycle: vi.fn(), reorderTasks: vi.fn(),
  bulkUpdateTasks: vi.fn(), exportTasks: vi.fn(), importTasks: vi.fn(),
  getSavedFilters: vi.fn(), createSavedFilter: vi.fn(),
  // The header's ancestry strip (ADR-0094) asks for these; the mocked useQuery
  // above answers every non-project key with an empty list, so the strip renders
  // nothing and these only have to exist.
  getAncestry: vi.fn(), getNodeTypes: vi.fn(),
}))

// Each view reports the ids it received, so the assertions can be about the
// data that reached it rather than its rendering. Hoisted, because vi.mock
// factories are lifted above ordinary top-level declarations.
const reporter = vi.hoisted(() => (name) => ({ tasks = [] }) => (
  <div data-testid={name}>{tasks.map(t => t.id).join(',')}</div>
))
vi.mock('../../components/BoardView', () => ({ default: reporter('board') }))
vi.mock('../../components/TableView', () => ({ default: reporter('table') }))
vi.mock('../../components/CalendarView', () => ({ default: reporter('calendar') }))
vi.mock('../../components/GanttChart', () => ({ default: reporter('timeline') }))

vi.mock('../../components/IssueRow', () => ({
  default: ({ task }) => <div data-testid="issue-row">{task.id}</div>,
}))
vi.mock('../../components/CyclePanel', () => ({ default: () => <div>cycles</div> }))
vi.mock('../../components/NodeShareFacet', () => ({ default: () => null }))
vi.mock('../../components/WebhookPanel', () => ({ default: () => null }))
vi.mock('../../components/BuildHistoryPanel', () => ({ default: () => null }))
vi.mock('../../components/ChildContainersPanel', () => ({ default: () => null }))
vi.mock('../../components/TaskCreateForm', () => ({
  default: ({ showForm }) => (showForm ? <div data-testid="create-form" /> : null),
}))
vi.mock('../../components/project/BulkToolbar', () => ({ default: () => null }))
vi.mock('../../components/project/LabelManager', () => ({
  default: () => null,
  LabelChip: () => null,
}))

import ProjectDetail from '../ProjectDetail'

// MemoryRouter keeps its history off window.location, so the URL under test is
// read from the router itself.
function LocationProbe() {
  const { search } = useLocation()
  return <div data-testid="location-search">{search}</div>
}

function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

const idsIn = (testId) => screen.getByTestId(testId).textContent.split(',').filter(Boolean)
const currentSearch = () => screen.getByTestId('location-search').textContent

describe('ProjectDetail — one filtered set for every view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries a status filter into the Board view', () => {
    renderAt('/projects/p1?tab=board&status=todo')

    expect(idsIn('board')).toEqual(['a', 'c'])
    expect(idsIn('board')).not.toContain('b')
  })

  it.each(['board', 'table', 'calendar', 'timeline'])(
    'carries the filter into the %s view too',
    (tab) => {
      renderAt(`/projects/p1?tab=${tab}&status=done`)
      expect(idsIn(tab)).toEqual(['b'])
    },
  )

  it('keeps the filter strip visible on a non-Issues tab', () => {
    renderAt('/projects/p1?tab=board&status=todo')

    // The strip's search box is what proves the control is still on screen.
    expect(screen.getByPlaceholderText('Search issues…')).toBeTruthy()
  })

  it('restores the view and the filter from the URL', () => {
    renderAt('/projects/p1?tab=table&priority=high')

    expect(screen.getByTestId('table')).toBeTruthy()
    expect(idsIn('table')).toEqual(['a'])
  })

  it('falls back to the preferred default view when the URL says nothing', () => {
    renderAt('/projects/p1')

    expect(screen.getAllByTestId('issue-row').length).toBe(TASKS.length)
    expect(screen.queryByTestId('board')).toBeNull()
  })

  it('writes the chosen tab into the URL so it survives a reload', () => {
    renderAt('/projects/p1')

    fireEvent.click(screen.getByText('Board'))

    expect(screen.getByTestId('board')).toBeTruthy()
    expect(currentSearch()).toContain('tab=board')
  })

  it('writes a chosen filter into the URL and drops it again when cleared', () => {
    renderAt('/projects/p1')

    fireEvent.click(screen.getByText(/^Done/))
    expect(currentSearch()).toContain('status=done')

    // `all` is the absence of a filter, so it leaves rather than being written.
    fireEvent.click(screen.getByText(/^All/))
    expect(currentSearch()).not.toContain('status=')
  })

  it('opens the create form when asked for by ?new=task', () => {
    renderAt('/projects/p1?new=task')

    expect(screen.getByTestId('create-form')).toBeTruthy()
  })
})
