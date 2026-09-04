import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import MembershipPanel from '../MembershipPanel'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useQuery: vi.fn(),
  useQueries: vi.fn(() => []),
  getProjects: vi.fn(),
  getNodeTypes: vi.fn(),
  getNode: vi.fn(),
  getNodes: vi.fn(),
  getNodeEdges: vi.fn(),
  getEdgeTypes: vi.fn(),
  getRelationOptions: vi.fn(),
  getDecisionsGoverning: vi.fn(),
  addTaskMembership: vi.fn(() => Promise.resolve()),
  removeTaskMembership: vi.fn(() => Promise.resolve()),
  attachNodeEdge: vi.fn(() => Promise.resolve()),
  detachNodeEdge: vi.fn(() => Promise.resolve()),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useQueries: (...args) => mocks.useQueries(...args),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  // `GoverningDecisions` became writable with ADR-0128, so this panel's tree now holds a
  // mutation as well as queries.
  useMutation: (options) => ({ mutate: (payload) => { mocks.mutate?.(payload); options?.onSuccess?.() } }),
}))

vi.mock('../../api/client', () => ({
  getProjects: mocks.getProjects,
  getNodeTypes: mocks.getNodeTypes,
  getNode: mocks.getNode,
  getNodes: mocks.getNodes,
  getNodeEdges: mocks.getNodeEdges,
  getEdgeTypes: mocks.getEdgeTypes,
  getRelationOptions: mocks.getRelationOptions,
  getDecisionsGoverning: mocks.getDecisionsGoverning,
  addTaskMembership: mocks.addTaskMembership,
  removeTaskMembership: mocks.removeTaskMembership,
  attachNodeEdge: mocks.attachNodeEdge,
  detachNodeEdge: mocks.detachNodeEdge,
}))

const projects = [
  { id: 'pA', name: 'Alpha' },
  { id: 'pB', name: 'Beta' },
  { id: 'pC', name: 'Gamma' },
]

function mockQueries({ nodeTypes = [], edgeTypes = [], taskEdges = [], governing = [], relationOptions = [] } = {}) {
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'governing-decisions') return { data: governing }
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
    if (queryKey[0] === 'relation-options') return { data: relationOptions, isLoading: false }
    if (queryKey[0] === 'node-edges') return { data: taskEdges }
    if (queryKey[0] === 'node-search') return { data: [], isFetching: false }
    return { data: projects }
  })
}

function renderPanel(props) {
  return render(<MemoryRouter><MembershipPanel {...props} /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQueries.mockReturnValue([])
  mockQueries()
})

const task = { id: 't1', project_ids: ['pA', 'pB'] }

describe('MembershipPanel', () => {
  it('lists memberships and marks the current project', () => {
    renderPanel({ projectId: "pA", task })
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
    // The current project chip is annotated; Beta (secondary) is not.
    expect(screen.getByText(/Alpha.*membership\.thisProject/)).toBeInTheDocument()
  })

  it('only offers projects that are not already linked and not the current one', () => {
    renderPanel({ projectId: "pA", task })
    // Scoped by label: since ADR-0150 the relation picker is a second combobox in
    // this panel, and a bare getByRole('combobox') would pick whichever came first.
    const select = screen.getByLabelText('membership.pickProject')
    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Gamma')
    expect(options).not.toContain('Alpha')
    expect(options).not.toContain('Beta')
  })

  it('unlinks a secondary membership', () => {
    renderPanel({ projectId: "pA", task })
    fireEvent.click(screen.getByLabelText('unlink Beta'))
    expect(mocks.removeTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pB')
  })

  it('can unlink the current project too (no primary, ADR-0032)', () => {
    renderPanel({ projectId: "pA", task })
    fireEvent.click(screen.getByLabelText('unlink Alpha'))
    expect(mocks.removeTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pA')
  })

  it('links the task into another project', () => {
    renderPanel({ projectId: "pA", task })
    fireEvent.change(screen.getByLabelText('membership.pickProject'), { target: { value: 'pC' } })
    fireEvent.click(screen.getByText('membership.link'))
    expect(mocks.addTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pC')
  })

  it('hides the container section when no custom container types exist', () => {
    renderPanel({ projectId: "pA", task })
    expect(screen.queryByText('membership.containers')).not.toBeInTheDocument()
  })

  it('shows custom container chips and unlinks them via the node-edge API (ADR-0037)', () => {
    mockQueries({ nodeTypes: [{ key: 'topic', label: 'Topic', roles: ['container'], color: '#f59e0b' }] })
    mocks.useQueries.mockReturnValue([{ data: { id: 'c1', type: 'topic', title: 'Research' } }])
    const withContainer = { ...task, container_ids: ['pA', 'pB', 'c1'] }
    renderPanel({ projectId: "pA", task: withContainer })
    expect(screen.getByText('membership.containers')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('unlink container Research'))
    expect(mocks.detachNodeEdge).toHaveBeenCalledWith('c1', 't1', 'contains')
  })

  it('says which decisions govern the task, once', () => {
    // ADR-0118 gave `governs` a reverse read with no reader. As a bare edge row it also
    // said nothing about the decision's status, so a task being run on thinking that had
    // already been replaced looked exactly like one that was not.
    mockQueries({
      governing: [{ id: 'd1', name: 'Use PostgreSQL', decision_status: 'superseded' }],
      edgeTypes: [{ key: 'governs', label: 'Governs', is_builtin: true }],
      taskEdges: [{
        id: 'e9', source_id: 'd1', target_id: 't1', rel_type: 'governs',
        source: { id: 'd1', type: 'decision', title: 'Use PostgreSQL' },
      }],
    })
    renderPanel({ projectId: 'pA', task })
    expect(screen.getByText('decisions.governedBy')).toBeInTheDocument()
    // Drawn by the decision strip, not also as a raw edge row below it.
    expect(screen.getAllByText('Use PostgreSQL')).toHaveLength(1)
    expect(screen.queryByText('Governs')).not.toBeInTheDocument()
  })

  it('offers the relation picker even when the task has no other relations yet', () => {
    // Deliberate change (ADR-0150). The section used to be hidden unless a *custom*
    // edge type existed or an edge was already there — so the control that creates a
    // relation was visible only once you had one, and the empty state, which is the
    // state where somebody is looking for it, showed nothing at all. Same shape as the
    // `governs` picker ADR-0122/0128 had to un-hide for the same reason.
    mockQueries({ relationOptions: [
      { rel_type: 'depends_on', direction: 'outgoing', label: 'Depends on', other_types: ['task'], is_containment: false, is_symmetric: false },
    ] })
    renderPanel({ projectId: 'pA', task })
    expect(screen.getByText('membership.otherRelations')).toBeInTheDocument()
    expect(screen.getByLabelText('relationPicker.relation')).toBeInTheDocument()
  })

  it('lists non-core edges with labels and unlinks respecting direction (ADR-0037)', () => {
    mockQueries({
      edgeTypes: [
        { key: 'contains', label: 'Contains', is_builtin: true },
        { key: 'references', label: 'References', is_builtin: false },
      ],
      taskEdges: [
        // Core containment edge must not appear in the section.
        { id: 'e0', source_id: 'pA', target_id: 't1', rel_type: 'contains' },
        {
          id: 'e1', source_id: 't1', target_id: 'nX', rel_type: 'references',
          target: { id: 'nX', type: 'topic', title: 'Spec' },
        },
        {
          id: 'e2', source_id: 'nY', target_id: 't1', rel_type: 'references',
          source: { id: 'nY', type: 'topic', title: 'Design doc' },
        },
      ],
    })
    renderPanel({ projectId: 'pA', task })
    expect(screen.getByText('membership.otherRelations')).toBeInTheDocument()
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('Design doc')).toBeInTheDocument()

    // Outgoing edge: task is the source.
    fireEvent.click(screen.getByLabelText('unlink relation Spec'))
    expect(mocks.detachNodeEdge).toHaveBeenCalledWith('t1', 'nX', 'references')
    // Incoming edge: neighbor is the source.
    fireEvent.click(screen.getByLabelText('unlink relation Design doc'))
    expect(mocks.detachNodeEdge).toHaveBeenCalledWith('nY', 't1', 'references')
  })

  it('offers each relation once per direction it is legal in (ADR-0150)', () => {
    // The old picker listed custom edge types only and always wrote `task -> other`,
    // so a relation whose task end is the *target* — `governs`, `owns` — could not be
    // created here at all, and one that was legal both ways looked like one choice.
    mockQueries({ relationOptions: [
      { rel_type: 'references', direction: 'outgoing', label: 'References', other_types: ['topic'], is_containment: false, is_symmetric: false },
      { rel_type: 'governs', direction: 'incoming', label: 'Governs', other_types: ['decision'], is_containment: false, is_symmetric: false },
    ] })
    renderPanel({ projectId: 'pA', task })
    const select = screen.getByLabelText('relationPicker.relation')
    const groups = Array.from(select.querySelectorAll('optgroup')).map(g => g.label)
    expect(groups).toEqual(['relationPicker.thisToOther', 'relationPicker.otherToThis'])
    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('→ References')
    expect(options).toContain('← Governs')

    // The node search appears only once a relation is chosen, and it is the direction
    // of that choice that decides which end of the edge this node is.
    fireEvent.change(select, { target: { value: 'governs:incoming' } })
    expect(screen.getByPlaceholderText('relationPicker.findNode')).toBeInTheDocument()
  })
})
