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

function mockQueries({ nodeTypes = [], edgeTypes = [], taskEdges = [], governing = [] } = {}) {
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'governing-decisions') return { data: governing }
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
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
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.textContent)
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pC' } })
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
    // Drawn by the decision strip, not also as a raw edge in "other relations".
    expect(screen.getAllByText('Use PostgreSQL')).toHaveLength(1)
    expect(screen.queryByText('membership.otherRelations')).not.toBeInTheDocument()
  })

  it('hides the other-relations section without custom edge types or edges', () => {
    renderPanel({ projectId: 'pA', task })
    expect(screen.queryByText('membership.otherRelations')).not.toBeInTheDocument()
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

  it('attaches a custom relation from the task after picking the type', () => {
    mockQueries({ edgeTypes: [{ key: 'references', label: 'References', is_builtin: false }] })
    renderPanel({ projectId: 'pA', task })
    // Pick the relation type; the node combobox then appears.
    fireEvent.change(screen.getByLabelText('membership.pickRelation'), { target: { value: 'references' } })
    expect(screen.getByPlaceholderText('membership.linkRelation')).toBeInTheDocument()
  })
})
