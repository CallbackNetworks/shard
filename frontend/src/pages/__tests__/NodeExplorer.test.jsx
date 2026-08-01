import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts && 'n' in opts ? `${k}:${opts.n}` : k),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getNodeTypes: vi.fn(), getEdgeTypes: vi.fn(), getNodes: vi.fn(), createNode: vi.fn(),
  deleteNode: vi.fn(), getNodeEdges: vi.fn(), attachNodeEdge: vi.fn(), detachNodeEdge: vi.fn(),
}))

import NodeExplorer from '../NodeExplorer'

const nodeTypes = [
  { key: 'topic', label: 'Topic', is_builtin: false, roles: [] },
  { key: 'project', label: 'Project', is_builtin: true, roles: ['container'] },
]
const edgeTypes = [{ key: 'contains', label: 'Contains', is_builtin: true, is_containment: true, is_symmetric: false }]
const topicNodes = [
  { id: 'n1', type: 'topic', title: 'Roadmap' },
  { id: 'n2', type: 'topic', title: 'Backlog' },
]
const edges = [{ id: 'e1', source_id: 'n1', target_id: 'p1', rel_type: 'contains' }]

const last = {}

function setup() {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
    if (queryKey[0] === 'nodes') return { data: topicNodes, isLoading: false }
    if (queryKey[0] === 'node-edges') return { data: edges }
    return { data: [] }
  })
  mockUseMutation.mockImplementation(({ mutationFn, onSuccess }) => ({
    mutate: vi.fn((arg) => { last.arg = arg; last.fn = mutationFn; if (onSuccess) onSuccess(undefined, arg) }),
    isPending: false,
  }))
  return render(<MemoryRouter><NodeExplorer /></MemoryRouter>)
}

describe('NodeExplorer', () => {
  it('renders title and node list for the default type', () => {
    setup()
    expect(screen.getByText('nodeExplorer.title')).toBeTruthy()
    expect(screen.getByText('Roadmap')).toBeTruthy()
    expect(screen.getByText('Backlog')).toBeTruthy()
  })

  it('shows a create form for a custom (non-builtin) type', () => {
    setup()
    expect(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder')).toBeTruthy()
  })

  it('create button is disabled until a title is entered', () => {
    setup()
    const btn = screen.getByText('nodeExplorer.add').closest('button')
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder'), { target: { value: 'New topic' } })
    expect(screen.getByText('nodeExplorer.add').closest('button').disabled).toBe(false)
  })

  it('creates a node with the selected type', () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder'), { target: { value: 'New topic' } })
    fireEvent.click(screen.getByText('nodeExplorer.add').closest('button'))
    expect(last.arg).toMatchObject({ type: 'topic', title: 'New topic' })
  })

  it('selecting a node reveals its edges', () => {
    setup()
    fireEvent.click(screen.getByText('Roadmap'))
    expect(screen.getByText('nodeExplorer.edges')).toBeTruthy()
    expect(screen.getByText('contains')).toBeTruthy()
  })
})
