import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Mock useBreakpoint
vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

// Mock ToastContext
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

// Mock @tanstack/react-query
const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

// Mock api/client
vi.mock('../../api/client', () => ({
  getGoals: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getProjects: vi.fn(),
}))

import Goals from '../Goals'

const mockGoals = [
  {
    id: 1,
    title: 'Ship v2.0',
    description: 'Release version 2.0 with new features',
    status: 'active',
    progress: 45,
    target_date: '2026-12-31',
    projects: [{ project_id: 1, project_name: 'Project A', progress: 50 }],
  },
  {
    id: 2,
    title: 'Improve test coverage',
    description: 'Reach 90% coverage',
    status: 'completed',
    progress: 100,
    target_date: '2026-06-01',
    projects: [],
  },
  {
    id: 3,
    title: 'Cancelled goal',
    description: null,
    status: 'cancelled',
    progress: 10,
    target_date: null,
    projects: [],
  },
]

const mockProjects = [
  { id: 1, name: 'Project A', status: 'active', progress: 50 },
]

function setup(options = {}) {
  const { goals = mockGoals, projects = mockProjects, isLoading = false } = options

  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'projects') return { data: projects, isLoading: false }
    if (queryKey[0] === 'goals') {
      // The component uses two queries: ['goals', statusFilter] and ['goals'] (for counts)
      // When queryKey has only one element, it is the "allGoals" query used for counts
      if (queryKey.length === 1) return { data: goals, isLoading: false }
      return { data: isLoading ? [] : goals, isLoading }
    }
    return { data: [], isLoading: false }
  })

  mockUseMutation.mockImplementation(({ onSuccess }) => ({
    mutate: vi.fn(() => { if (onSuccess) onSuccess() }),
    isPending: false,
  }))

  return render(
    <MemoryRouter>
      <Goals />
    </MemoryRouter>
  )
}

describe('Goals', () => {
  it('renders the goals title', () => {
    setup()
    expect(screen.getByText('goals.title')).toBeTruthy()
  })

  it('renders the subtitle', () => {
    setup()
    expect(screen.getByText('goals.subtitle')).toBeTruthy()
  })

  it('renders status filter tabs', () => {
    setup()
    expect(screen.getByText('goals.filterAll')).toBeTruthy()
    expect(screen.getByText('goals.filterActive')).toBeTruthy()
    expect(screen.getByText('goals.filterCompleted')).toBeTruthy()
    expect(screen.getByText('goals.filterCancelled')).toBeTruthy()
  })

  it('renders tab counts', () => {
    setup()
    // 3 total, 1 active, 1 completed, 1 cancelled
    expect(screen.getByText('3')).toBeTruthy()
    // Each count of 1 will appear multiple times (active, completed, cancelled tabs)
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(3)
  })

  it('renders goal cards', () => {
    setup()
    expect(screen.getByText('Ship v2.0')).toBeTruthy()
    expect(screen.getByText('Improve test coverage')).toBeTruthy()
    expect(screen.getByText('Cancelled goal')).toBeTruthy()
  })

  it('renders goal descriptions', () => {
    setup()
    expect(screen.getByText('Release version 2.0 with new features')).toBeTruthy()
    expect(screen.getByText('Reach 90% coverage')).toBeTruthy()
  })

  it('renders goal progress percentages', () => {
    setup()
    expect(screen.getByText('45%')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText('10%')).toBeTruthy()
  })

  it('shows empty state when no goals exist', () => {
    setup({ goals: [] })
    expect(screen.getByText('goals.empty')).toBeTruthy()
    expect(screen.getByText('goals.emptyHint')).toBeTruthy()
  })

  it('renders create button', () => {
    setup()
    expect(screen.getByText('goals.create')).toBeTruthy()
  })

  it('opens form modal when create button is clicked', () => {
    setup()
    // Click the create button in the header
    const createButtons = screen.getAllByText('goals.create')
    fireEvent.click(createButtons[0])
    // Form modal should appear with the create title
    expect(screen.getByText('goals.createTitle')).toBeTruthy()
    expect(screen.getByPlaceholderText('goals.titlePlaceholder')).toBeTruthy()
  })

  it('shows loading state', () => {
    setup({ isLoading: true, goals: [] })
    expect(screen.getByText('loading')).toBeTruthy()
  })

  it('renders linked project chips on goal cards', () => {
    setup()
    expect(screen.getByText('Project A')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })
})
