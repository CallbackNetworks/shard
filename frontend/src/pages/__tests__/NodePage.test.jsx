import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, useParams: () => ({ id: 'n1' }), useNavigate: () => mockNavigate }
})

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../api/client', () => ({
  getNode: vi.fn(), getNodeEdges: vi.fn(), getNodeEvents: vi.fn(),
  getNodeTypes: vi.fn(), getEdgeTypes: vi.fn(), getNodes: vi.fn(),
  updateNode: vi.fn(), deleteNode: vi.fn(), attachNodeEdge: vi.fn(), detachNodeEdge: vi.fn(),
}))

import NodePage from '../NodePage'

const nodeTypes = [
  { key: 'topic', label: 'Topic', is_builtin: false, color: '#f59e0b' },
  { key: 'project', label: 'Project', is_builtin: true, color: '#818cf8' },
  { key: 'task', label: 'Task', is_builtin: true, color: '#22c55e' },
]
const edgeTypes = [
  { key: 'contains', label: 'Contains', is_containment: true },
  { key: 'references', label: 'References', is_containment: false },
]
const node = { id: 'n1', type: 'topic', title: 'Research', status: null, priority: null, due_date: null }
const edges = [
  {
    id: 'e1', source_id: 'n1', target_id: 'p1', rel_type: 'contains',
    source: { id: 'n1', type: 'topic', title: 'Research', status: null },
    target: { id: 'p1', type: 'project', title: 'Shard', status: 'active' },
  },
  {
    id: 'e2', source_id: 't9', target_id: 'n1', rel_type: 'references',
    source: { id: 't9', type: 'task', title: 'Write summary', status: 'todo' },
    target: { id: 'n1', type: 'topic', title: 'Research', status: null },
  },
]
const events = [
  { id: 'ev1', event: 'node_created', rel_type: null, actor: null, created_at: '2026-07-18T00:00:00Z' },
]

const last = {}

function setup({ nodeData = node } = {}) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node') return { data: nodeData, isLoading: false, isError: !nodeData }
    if (queryKey[0] === 'node-edges') return { data: edges }
    if (queryKey[0] === 'node-events') return { data: events }
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
    if (queryKey[0] === 'node-search') return { data: [] }
    return { data: [] }
  })
  mockUseMutation.mockImplementation(({ mutationFn, onSuccess }) => ({
    mutate: vi.fn((arg) => { last.arg = arg; last.fn = mutationFn; if (onSuccess) onSuccess(undefined, arg) }),
    isPending: false,
    isError: false,
  }))
  return render(<MemoryRouter><NodePage /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('NodePage', () => {
  it('renders the node header with its type chip', () => {
    setup()
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getAllByText('Topic').length).toBeGreaterThan(0)
    expect(screen.getByText('n1')).toBeInTheDocument()
  })

  it('groups edges by rel_type with containment first and shows neighbor titles', () => {
    setup()
    const groupLabels = screen.getAllByText(/^(Contains|References)$/)
      .filter(el => el.tagName !== 'OPTION')
      .map(el => el.textContent)
    expect(groupLabels).toEqual(['Contains', 'References'])
    expect(screen.getByText('Shard')).toBeInTheDocument()
    expect(screen.getByText('Write summary')).toBeInTheDocument()
  })

  it('navigates to the neighbor page on click (project goes to its detail page)', () => {
    setup()
    fireEvent.click(screen.getByText('Shard'))
    expect(mockNavigate).toHaveBeenCalledWith('/projects/p1')
    fireEvent.click(screen.getByText('Write summary'))
    expect(mockNavigate).toHaveBeenCalledWith('/n/t9')
  })

  it('detaches an incoming edge with the neighbor as source', () => {
    setup()
    const detachButtons = screen.getAllByLabelText('nodePage.detach')
    fireEvent.click(detachButtons[1]) // the incoming references edge
    expect(last.arg).toEqual({ sourceId: 't9', targetId: 'n1', relType: 'references' })
  })

  it('shows history events when expanded', () => {
    setup()
    fireEvent.click(screen.getByText('nodePage.history'))
    expect(screen.getByText('node_created')).toBeInTheDocument()
  })

  it('shows not-found for a missing node', () => {
    setup({ nodeData: null })
    expect(screen.getByText('nodePage.notFound')).toBeInTheDocument()
  })
})
