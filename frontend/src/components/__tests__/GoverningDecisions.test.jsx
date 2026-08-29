import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, params) => params?.count !== undefined ? `${key}:${params.count}` : key }),
}))

const mockUseQuery = vi.fn()
const mutate = vi.fn()
const invalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (options) => ({ mutate: (payload) => { mutate(payload); options?.onSuccess?.() } }),
  useQueryClient: () => ({ invalidateQueries }),
}))

const getDecisionsGoverning = vi.fn()
const linkDecisionToWork = vi.fn()
const unlinkDecisionFromWork = vi.fn()
vi.mock('../../api/client', () => ({
  getDecisionsGoverning: (...a) => getDecisionsGoverning(...a),
  linkDecisionToWork: (...a) => linkDecisionToWork(...a),
  unlinkDecisionFromWork: (...a) => unlinkDecisionFromWork(...a),
  getNodes: vi.fn(() => Promise.resolve([])),
  getNodeTypes: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../hooks/useFocusTrap', () => ({ default: () => ({ current: null }) }))

import GoverningDecisions from '../GoverningDecisions'

function setup(data, props = {}) {
  mockUseQuery.mockImplementation(({ queryKey, queryFn }) => {
    expect(typeof queryFn).toBe('function')
    return { data: queryKey[0] === 'governing-decisions' ? data : [] }
  })
  return render(
    <MemoryRouter>
      <GoverningDecisions nodeId="t1" {...props} />
    </MemoryRouter>
  )
}

describe('GoverningDecisions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the decisions that govern the node, with their status', () => {
    // ADR-0118 gave `governs` a read endpoint, a reverse read endpoint and two client
    // helpers, and no caller for any of them: a decision could say what it governed and
    // the governed work could not say what decided it.
    setup([
      { id: 'd1', name: 'Use PostgreSQL', decision_status: 'accepted' },
      { id: 'd2', name: 'Cache in Redis', decision_status: 'superseded' },
    ])
    expect(screen.getByText('decisions.governedBy:2')).toBeTruthy()
    expect(screen.getByText('Use PostgreSQL')).toBeTruthy()
    // The status travels with the chip: work run on thinking that has been replaced is
    // the case worth seeing without opening the record.
    expect(screen.getByText('decisions.superseded')).toBeTruthy()
    expect(screen.getByText('Cache in Redis').closest('a').getAttribute('href')).toBe('/n/d2')
  })

  it('renders nothing when nothing governs the node and it is read-only', () => {
    // Read-only, this is pure output; almost no node has an answer yet, so an empty
    // heading would be a row of noise on every page that mounts it.
    const { container } = setup([])
    expect(container.innerHTML).toBe('')
  })

  it('shows the empty state when it is writable, because that is the state it exists for', () => {
    // ADR-0128. `governs` had one control in the whole app, on the decision side, and
    // production held one edge across 103 records. Hiding the strip when there is nothing
    // to show also hides the only thing that would create something to show.
    setup([], { editable: true })
    expect(screen.getByText('decisions.governedByNone')).toBeTruthy()
    expect(screen.getByText('decisions.governedByAdd')).toBeTruthy()
  })

  it('links a decision with the decision as the edge source', () => {
    // The relation is declared `decision -> task|container` (ADR-0078). Reached from the
    // work's side the ends are the same; naming them the other way round is a 400.
    setup([], { editable: true })
    fireEvent.click(screen.getByText('decisions.governedByAdd'))
    expect(screen.getByText('decisions.governedByHint')).toBeTruthy()
  })

  it('cuts the link from the work side too', () => {
    window.confirm = vi.fn(() => true)
    setup([{ id: 'd1', name: 'Use PostgreSQL', decision_status: 'accepted' }], { editable: true })
    fireEvent.click(screen.getByLabelText('decisions.ungovern'))
    expect(mutate).toHaveBeenCalledWith({ decisionId: 'd1' })
  })
})
