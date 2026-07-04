import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
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
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'projects') return { data: projectData, isLoading: false }
    if (queryKey[0] === 'activity') return { data: activityData, isLoading: false }
    if (queryKey[0] === 'goals') return { data: [{ id: 'g1', title: 'Grow system', status: 'active' }], isLoading: false }
    if (queryKey[0] === 'decisions') return { data: [{ id: 'd1', name: 'Pick layout', decision_status: 'proposed' }], isLoading: false }
    if (queryKey[0] === 'identity-hub-stats') return { data: null, isLoading: false }
    return { data: [], isLoading: false }
  })

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

  it('navigates to the project when a lane task is clicked', () => {
    setup()
    fireEvent.click(screen.getByText('Build flow').closest('button'))
    expect(navigate).toHaveBeenCalledWith('/projects/p1')
  })

  it('handles empty projects without crashing', () => {
    setup({ projectData: [], activityData: [] })
    expect(screen.getByText('dashboard.gettingStarted')).toBeTruthy()
  })
})
