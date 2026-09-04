import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

const navigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => navigate }
})

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getActivity: vi.fn(),
  getIdentityHubStats: vi.fn(),
  getGoals: vi.fn(),
  getDecisions: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
  getAncestry: vi.fn(),
  // The hero and the briefing route by node type now (ADR-0147), so the page
  // reaches the type registry. `useQuery` is mocked below and never calls a
  // queryFn — this export exists so the module-level reference resolves.
  getNodeTypes: vi.fn(),
}))

vi.mock('../../components/AgentTasksPanel', () => ({
  default: () => <div>AgentTasksPanel</div>,
}))

vi.mock('../../components/IdentityChartsView', () => ({
  default: () => <div>IdentityChartsView</div>,
}))

vi.mock('../../components/OverviewViews', () => ({
  ViewProgress: () => <div>ViewProgress</div>,
  ViewHealth: () => <div>ViewHealth</div>,
  ViewTasks: () => <div>ViewTasks</div>,
  ViewCompare: () => <div>ViewCompare</div>,
  getPinnedIds: () => [],
  togglePin: () => [],
}))

import Dashboard from '../Dashboard'

const projects = [
  {
    id: 'p1',
    name: 'Alpha',
    status: 'active',
    total_tasks: 4,
    done_tasks: 1,
    progress: 25,
    tasks: [
      { id: 'late', title: 'Late issue', status: 'todo', priority: 'medium', due_date: '2026-01-01T00:00:00Z' },
      { id: 'motion', title: 'Build flow', status: 'in_progress', priority: 'medium' },
      { id: 'wait', title: 'Queued review', status: 'queued', priority: 'low' },
      { id: 'done', title: 'Shipped change', status: 'done', updated_at: new Date().toISOString() },
    ],
  },
]

const activities = [
  { id: 'a1', action: 'task.created', detail: 'Latest signal', created_at: new Date().toISOString() },
]

function setup({ projectData = projects, activityData = activities } = {}) {
  mockUseMutation.mockReturnValue({ mutate: vi.fn(), isPending: false })

  // One stable result object per query key, built once per setup(). React Query gives
  // a caller the same reference back while the data is unchanged (structural sharing),
  // and any effect keyed on a query result depends on that. A mock returning a fresh
  // object literal per call does not merely differ from the real thing — it turns
  // `useEffect(..., [result])` into an infinite render loop, which is exactly what it
  // did here: this file spun at 100% CPU for 40 minutes in CI and never finished.
  const results = {
    projects: { data: projectData, isLoading: false },
    activity: { data: activityData, isLoading: false },
    goals: { data: [{ id: 'g1', title: 'Grow system', status: 'active' }], isLoading: false },
    decisions: { data: [{ id: 'd1', name: 'Pick layout', decision_status: 'proposed' }], isLoading: false },
    'identity-hub-stats': { data: null, isLoading: false },
  }
  const fallback = { data: [], isLoading: false }
  mockUseQuery.mockImplementation(({ queryKey }) => results[queryKey[0]] ?? fallback)

  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  )
}

describe('Dashboard Command Center', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Command Center hero and lanes', () => {
    setup()
    expect(screen.getAllByText('dashboard.commandCenter').length).toBeGreaterThan(0)
    expect(screen.getAllByText('dashboard.critical').length).toBeGreaterThan(0)
    expect(screen.getAllByText('dashboard.inMotion').length).toBeGreaterThan(0)
    expect(screen.getByText('dashboard.waiting')).toBeTruthy()
    expect(screen.getByText('dashboard.doneToday')).toBeTruthy()
  })

  it('classifies tasks into visible command lanes', () => {
    setup()
    expect(screen.getByText('Late issue')).toBeTruthy()
    expect(screen.getByText('Build flow')).toBeTruthy()
    expect(screen.getByText('Queued review')).toBeTruthy()
    expect(screen.getByText('Shipped change')).toBeTruthy()
  })

  // Was `/projects/p1`. Landing on the project was the whole of the old behaviour
  // and the whole of the defect: a board of forty cards with nothing saying which
  // one you clicked (ADR-0147).
  it('opens the clicked lane task, not just its project', () => {
    setup()
    fireEvent.click(screen.getByText('Build flow').closest('button'))
    expect(navigate).toHaveBeenCalledWith('/projects/p1?focus=motion')
  })

  it('handles empty projects without crashing', () => {
    setup({ projectData: [], activityData: [] })
    expect(screen.getByText('dashboard.gettingStarted')).toBeTruthy()
  })
})
