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
  createDecision: vi.fn(),
  updateDecision: vi.fn(),
  deleteDecision: vi.fn(),
  exportDecision: vi.fn(),
  supersedeDecision: vi.fn(),
  unsupersedeDecision: vi.fn(),
}))

import Decisions from '../Decisions'

const projects = [
  { id: 'p1', name: 'Project One' },
]

const decisions = [
  { id: 'd1', project_id: 'p1', name: 'Pending layout', description: 'Pending desc', decision_status: 'proposed', source: 'manual' },
  { id: 'd2', project_id: 'p1', name: 'Accepted API', description: 'Accepted desc', decision_status: 'accepted', source: 'ai',
    supersedes: [{ id: 'd3', type: 'decision', title: 'Old API' }],
    governs: [{ id: 't1', type: 'task', title: 'Rewrite the client' }] },
  { id: 'd3', project_id: 'p1', name: 'Old API', description: 'Old desc', decision_status: 'superseded', source: 'manual',
    superseded_by: [{ id: 'd2', type: 'decision', title: 'Accepted API' }] },
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
    expect(screen.getByText('decisions.lineage')).toBeTruthy()
    expect(screen.getByText('Pending layout')).toBeTruthy()
    expect(screen.getByText('Accepted API')).toBeTruthy()
  })

  it('accepts a proposed decision', () => {
    setup()
    fireEvent.click(screen.getByText('decisions.accept').closest('button'))
    expect(mutate).toHaveBeenCalledWith({
      id: 'd1',
      data: { decision_status: 'accepted' },
    })
  })

  it('rejecting deprecates the record instead of deleting it', () => {
    // A decision that was considered and turned down is still something that was
    // decided; the old Reject button called delete and the history went with it.
    setup()
    fireEvent.click(screen.getByText('decisions.reject').closest('button'))
    expect(mutate).toHaveBeenCalledWith({
      id: 'd1',
      data: { decision_status: 'deprecated' },
    })
  })

  it('draws the supersession chain and what each decision governs', () => {
    setup()
    // The replaced record is nested under its replacement rather than filed by project.
    expect(screen.getByText('decisions.replacedByAbove')).toBeTruthy()
    expect(screen.getByText('decisions.supersedesName')).toBeTruthy()
    expect(screen.getByText('decisions.supersededByName')).toBeTruthy()
    expect(screen.getByText('decisions.governs:1')).toBeTruthy()
    expect(screen.getByText('Rewrite the client')).toBeTruthy()
  })

  it('links every card into the node explorer', () => {
    // ADR-0114 draws a node's relations on /n/{id}; the decisions page had no way there.
    const { container } = setup()
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(hrefs).toContain('/n/d1')
    expect(hrefs).toContain('/n/d2')
  })
})
