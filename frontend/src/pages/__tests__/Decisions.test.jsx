import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, params) => params?.count !== undefined ? `${key}:${params.count}` : key }),
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
  getNodeTypes: vi.fn(),
  getNodes: vi.fn(),
  getDecisionsGoverning: vi.fn(),
  createDecision: vi.fn(),
  updateDecision: vi.fn(),
  deleteDecision: vi.fn(),
  exportDecision: vi.fn(),
  supersedeDecision: vi.fn(),
  unsupersedeDecision: vi.fn(),
  linkDecisionToWork: vi.fn(),
  unlinkDecisionFromWork: vi.fn(),
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
  { id: 'd4', project_id: 'p1', name: 'Rejected cache', description: 'Rejected desc', decision_status: 'deprecated', source: 'manual' },
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

const clickText = (text) => fireEvent.click(screen.getByText(text).closest('button'))

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
    clickText('decisions.accept')
    expect(mutate).toHaveBeenCalledWith({
      id: 'd1',
      data: { decision_status: 'accepted' },
    })
  })

  it('rejecting deprecates the record instead of deleting it', () => {
    // A decision that was considered and turned down is still something that was
    // decided; the old Reject button called delete and the history went with it.
    setup()
    clickText('decisions.reject')
    expect(mutate).toHaveBeenCalledWith({
      id: 'd1',
      data: { decision_status: 'deprecated' },
    })
  })

  it('gives every status a way out, not just proposed', () => {
    // Accept/reject were the only status controls, so an accepted decision could never
    // be deprecated and a rejected one could never be reconsidered: the record was
    // writable exactly once and then frozen by its own outcome.
    setup()
    clickText('decisions.deprecate')
    expect(mutate).toHaveBeenCalledWith({ id: 'd2', data: { decision_status: 'deprecated' } })

    mutate.mockClear()
    clickText('decisions.reopen')
    expect(mutate).toHaveBeenCalledWith({ id: 'd4', data: { decision_status: 'proposed' } })
  })

  it('offers no status button for a superseded record', () => {
    // `superseded` is a consequence of the supersession edge. A button setting it, or
    // clearing it, would leave the status and the edge saying opposite things.
    setup()
    const card = screen.getByText('Old API').closest('.kt-decision-card')
    expect(card.textContent).not.toContain('decisions.accept')
    expect(card.textContent).not.toContain('decisions.reopen')
    expect(card.textContent).not.toContain('decisions.deprecate')
  })

  it('separates real chains from single records', () => {
    // Production holds 103 decisions and one supersession edge: a single "lineage"
    // section listing both made the one real chain indistinguishable from the rest.
    setup()
    expect(screen.getByText('decisions.standalone')).toBeTruthy()
    const chainCount = screen.getByText('decisions.lineage').nextSibling
    expect(chainCount.textContent).toBe('1')
  })

  it('states a supersession once, on the rail that draws it', () => {
    // The indent, the caption and both cards' chips were four renderings of one edge.
    // Inside a chain the rail is the statement — and it carries the withdraw control,
    // because the connector *is* the edge.
    setup()
    expect(screen.getByText('decisions.replacedByAbove')).toBeTruthy()
    expect(screen.queryByText('decisions.supersedesName')).toBeNull()
    expect(screen.queryByText('decisions.supersededByName')).toBeNull()

    fireEvent.click(screen.getByTitle('decisions.unsupersede'))
    expect(mutate).toHaveBeenCalledWith({ id: 'd2', supersededId: 'd3' })
  })

  it('draws what each decision governs, and can unlink it', () => {
    setup()
    expect(screen.getByText('decisions.governs:1')).toBeTruthy()
    expect(screen.getByText('Rewrite the client')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('decisions.ungovern'))
    expect(mutate).toHaveBeenCalledWith({ id: 'd2', nodeId: 't1' })
  })

  it('opens a picker that links a decision to work', () => {
    // `linkDecisionToWork` shipped with ADR-0118 and had zero callers: a decision could
    // be read as governing work and connected to it by nothing in the UI.
    setup()
    fireEvent.click(screen.getAllByText('decisions.governAction')[0])
    expect(screen.getByText('decisions.governHint')).toBeTruthy()
  })

  it('links every card into the node explorer', () => {
    // ADR-0114 draws a node's relations on /n/{id}; the decisions page had no way there.
    setup()
    fireEvent.click(screen.getAllByLabelText('more')[0])
    expect(screen.getByText('decisions.openNode').closest('a').getAttribute('href')).toBe('/n/d1')
  })
})
