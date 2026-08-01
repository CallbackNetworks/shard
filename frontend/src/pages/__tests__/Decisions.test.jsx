import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, params) => params?.count ? `${key}:${params.count}` : key }),
}))

vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

vi.mock('../../hooks/useFocusTrap', () => ({
  default: () => ({ current: null }),
}))

const mockUseQuery = vi.fn()
const mutate = vi.fn()
const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (options) => ({ mutate: (payload) => { mutate(payload); options?.onSuccess?.() } }),
  useQueryClient: () => ({ invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getDecisions: vi.fn(),
  getProjects: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
  exportDecision: vi.fn(),
}))

import Decisions from '../Decisions'

const projects = [
  { id: 'p1', name: 'Project One' },
]

const decisions = [
  { id: 'd1', project_id: 'p1', name: 'Pending layout', description: 'Pending desc', decision_status: 'proposed', source: 'manual' },
  { id: 'd2', project_id: 'p1', name: 'Accepted API', description: 'Accepted desc', decision_status: 'accepted', source: 'ai' },
]

function setup() {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'decisions') return { data: decisions, isLoading: false }
    if (queryKey[0] === 'projects') return { data: projects, isLoading: false }
    return { data: [], isLoading: false }
  })

  return render(
    <MemoryRouter>
      <Decisions />
    </MemoryRouter>
  )
}

describe('Decisions Decision Room', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.confirm = vi.fn(() => true)
  })

  it('renders decision room sections', () => {
    setup()
    expect(screen.getByText('decisions.room')).toBeTruthy()
    expect(screen.getByText('decisions.pendingQueue')).toBeTruthy()
    expect(screen.getByText('decisions.outcomes')).toBeTruthy()
    expect(screen.getByText('Pending layout')).toBeTruthy()
    expect(screen.getByText('Accepted API')).toBeTruthy()
  })

  it('accepts a proposed decision', () => {
    setup()
    fireEvent.click(screen.getByText('decisions.accept').closest('button'))
    expect(mutate).toHaveBeenCalledWith({
      projectId: 'p1',
      id: 'd1',
      data: { decision_status: 'accepted' },
    })
  })
})
