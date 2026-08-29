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
  getAncestry: vi.fn(),
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
  linkDecisionRelation: vi.fn(),
  unlinkDecisionRelation: vi.fn(),
}))

import Decisions from '../Decisions'

const projects = [
  { id: 'p1', name: 'Project One' },
]

const decisions = [
  { id: 'd1', project_id: 'p1', name: 'Pending layout', description: 'Pending desc', decision_status: 'proposed', source: 'manual' },
  { id: 'd2', project_id: 'p1', name: 'Accepted API', description: 'Accepted desc', decision_status: 'accepted', source: 'ai',
    supersedes: [{ id: 'd3', type: 'decision', title: 'Old API' }],
    required_by: [{ id: 'd4', type: 'decision', title: 'Rejected cache' }],
    governs: [{ id: 't1', type: 'task', title: 'Rewrite the client' }] },
  { id: 'd3', project_id: 'p1', name: 'Old API', description: 'Old desc', decision_status: 'superseded', source: 'manual',
    superseded_by: [{ id: 'd2', type: 'decision', title: 'Accepted API' }] },
  { id: 'd4', project_id: 'p1', name: 'Rejected cache', description: 'Rejected desc', decision_status: 'deprecated', source: 'manual',
    requires: [{ id: 'd2', type: 'decision', title: 'Accepted API' }],
    conflicts_with: [{ id: 'd1', type: 'decision', title: 'Pending layout' }] },
]

// Where each decision lives (ADR-0094). Every record here sits under one organization,
// so the page has a real hierarchy to draw rather than a flat project name per card.
const org = { id: 'o1', type: 'organization', type_label: 'Organization', title: 'Acme' }
const proj = { id: 'p1', type: 'project', type_label: 'Project', title: 'Project One' }
const ancestry = Object.fromEntries(
  ['d1', 'd2', 'd3', 'd4'].map(id => [id, { id, trails: [[org, proj]], owners: [] }])
)

function setup(rows = decisions, tree = ancestry) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'decisions') return { data: rows, isLoading: false }
    if (queryKey[0] === 'projects') return { data: projects, isLoading: false }
    if (queryKey[0] === 'ancestry') return { data: tree, isLoading: false }
    return { data: [], isLoading: false }
  })

  return render(
    <MemoryRouter>
      <Decisions />
    </MemoryRouter>
  )
}

const clickText = (text) => fireEvent.click(screen.getByText(text).closest('button'))
// The page and the open modal both list decisions, so a bare text query matches twice.
const modal = () => document.querySelector('.kt-modal')

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
  it('files decisions under the containers they live in', () => {
    // The page drew a project *name* as grey meta text on each card and nothing above
    // it, so the only structure on screen was supersession — of which production has
    // two edges across 103 records (ADR-0126).
    setup()
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Organization').length).toBeGreaterThan(0)
    const group = screen.getAllByText('Acme')[0].closest('[aria-expanded]')
    expect(group.getAttribute('aria-expanded')).toBe('true')
  })

  it('starts a big section collapsed, and opens one group at a time', () => {
    // The complaint this exists for: a hundred records arrive and the column is one
    // unreadable scroll. Below the limit the page reads as it always did; above it the
    // column is a list of containers.
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`, project_id: 'p1', name: `Bulk ${i}`, decision_status: 'accepted', source: 'manual',
    }))
    const tree = Object.fromEntries(many.map(m => [m.id, { id: m.id, trails: [[org, proj]], owners: [] }]))
    setup(many, tree)

    expect(screen.queryByText('Bulk 0')).toBeNull()
    const toggle = screen.getAllByText('Acme')[0].closest('[aria-expanded]')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    // Opening the organization reveals the project it holds, not 40 cards at once.
    const project = screen.getAllByText('Project One').find(el => el.closest('[aria-expanded]'))
    fireEvent.click(project.closest('[aria-expanded]'))
    expect(screen.getByText('Bulk 0')).toBeTruthy()
  })

  it('counts records, so a header never disagrees with the rows under it', () => {
    // The pending queue holds one record; its group must say 1, not "one lineage".
    setup()
    const queue = screen.getByText('decisions.pendingQueue').closest('section')
    const head = queue.querySelector('[aria-expanded]').parentElement
    expect(head.textContent).toContain('Acme')
    expect(head.textContent.endsWith('1')).toBe(true)
  })

  it('narrows the whole room by free text, counts included', () => {
    // A count beside a list it does not describe is the disagreement ADR-0068 exists to
    // prevent, so the scoreboard is derived from the filtered set too.
    setup()
    fireEvent.change(screen.getByLabelText('decisions.searchPlaceholder'), { target: { value: 'Rejected' } })
    expect(screen.getByText('Rejected cache')).toBeTruthy()
    expect(screen.queryByText('Accepted API')).toBeNull()
    expect(screen.queryByText('decisions.empty')).toBeNull()
  })

  it('does not offer "create your first decision" over a filtered-out list', () => {
    setup()
    fireEvent.change(screen.getByLabelText('decisions.searchPlaceholder'), { target: { value: 'zzzz no match' } })
    expect(screen.queryByText('decisions.emptyHint')).toBeNull()
    expect(screen.getByText('decisions.pendingQueue')).toBeTruthy()
  })

  it('keeps a decision nothing contains on screen', () => {
    // An unfiled decision is a real state of the graph, not a reason to drop a record.
    setup(decisions, {})
    expect(screen.getAllByText('decisions.unfiledGroup').length).toBeGreaterThan(0)
    expect(screen.getByText('Accepted API')).toBeTruthy()
  })
  it('draws a premise and a contradiction, and can cut either', () => {
    // ADR-0127. Production ran with 103 records and three non-containment edges: the two
    // relations a decision most often actually has did not exist, so 98 of them named
    // nothing and were named by nothing.
    setup()
    expect(screen.getByText('decisions.requiresName')).toBeTruthy()
    expect(screen.getByText('decisions.conflictsName')).toBeTruthy()
    expect(screen.getByText('decisions.requiredByName')).toBeTruthy()

    fireEvent.click(screen.getByTitle('decisions.unrequire'))
    expect(mutate).toHaveBeenCalledWith({ id: 'd4', otherId: 'd2', relType: 'requires' })

    mutate.mockClear()
    fireEvent.click(screen.getByTitle('decisions.unconflict'))
    expect(mutate).toHaveBeenCalledWith({ id: 'd4', otherId: 'd1', relType: 'conflicts_with' })
  })

  it('offers a cross-project candidate for a premise and refuses it for a supersession', () => {
    // `supersedes` stays inside one project (ADR-0118); `requires` and `conflicts_with`
    // reach across, because an organization-level premise for a project-level decision is
    // the interesting case and nothing in the declaration forbids it.
    const rows = [
      ...decisions,
      { id: 'x1', project_id: 'p2', name: 'Elsewhere decision', decision_status: 'accepted', source: 'manual' },
    ]
    const { unmount } = setup(rows, { ...ancestry, x1: { id: 'x1', trails: [[org]], owners: [] } })

    fireEvent.click(screen.getAllByLabelText('more')[0])
    fireEvent.click(screen.getByText('decisions.requiresAction'))
    expect(modal().textContent).toContain('Elsewhere decision')
    unmount()

    setup(rows, { ...ancestry, x1: { id: 'x1', trails: [[org]], owners: [] } })
    fireEvent.click(screen.getAllByText('decisions.supersedeAction')[0])
    expect(modal().textContent).not.toContain('Elsewhere decision')
  })

  it('creates the edge through the generic surface, not a relation-specific endpoint', () => {
    setup()
    fireEvent.click(screen.getAllByLabelText('more')[0])
    fireEvent.click(screen.getByText('decisions.conflictsAction'))
    const option = [...modal().querySelectorAll('button')].find(b => b.textContent.includes('Accepted API'))
    fireEvent.click(option)
    expect(mutate).toHaveBeenCalledWith({ id: 'd1', otherId: 'd2', relType: 'conflicts_with' })
  })

  it('uses one picker for all three decision-to-decision relations', () => {
    // Three modals listing the same rows and differing only in their heading is three
    // places to fix when the list needs a search box — which it did at a hundred records.
    setup()
    fireEvent.click(screen.getAllByText('decisions.supersedeAction')[0])
    expect(modal().querySelector('input[aria-label="decisions.searchPlaceholder"]')).toBeTruthy()
    expect(modal().textContent).toContain('decisions.supersedeHint')
  })
})
