import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts && 'total' in opts ? `${k}:${opts.n}/${opts.total}` : opts && 'n' in opts ? `${k}:${opts.n}` : k),
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
  getNodeTypes: vi.fn(), getEdgeTypes: vi.fn(), getNodes: vi.fn(), getNode: vi.fn(), createNode: vi.fn(),
  deleteNode: vi.fn(), getNodeEdges: vi.fn(), attachNodeEdge: vi.fn(), detachNodeEdge: vi.fn(),
  getGraphMap: vi.fn(), getAncestry: vi.fn(), getRelationOptions: vi.fn(),
}))

import NodeExplorer from '../NodeExplorer'
import { qk } from '../../api/queryKeys'

const nodeTypes = [
  { key: 'topic', label: 'Topic', is_builtin: false, roles: [], usage_count: 7 },
  { key: 'project', label: 'Project', is_builtin: true, roles: ['container'] },
]
const edgeTypes = [{ key: 'contains', label: 'Contains', is_builtin: true, is_containment: true, is_symmetric: false }]
const topicNodes = [
  { id: 'n1', type: 'topic', title: 'Roadmap' },
  { id: 'n2', type: 'topic', title: 'Backlog' },
]
// `EdgeOut` embeds each endpoint (`source`/`target`) precisely so a client need not
// resolve the id it is handed. This panel printed the id anyway.
const edges = [{
  id: 'e1', source_id: 'n1', target_id: 'p1', rel_type: 'contains',
  source: { id: 'n1', type: 'topic', title: 'Roadmap' },
  target: { id: 'p1', type: 'project', title: 'Shard' },
}]

const last = {}

// A row is a title plus the strip saying where the node lives, so the title and its
// wrapper both carry the same text; the assertions want the title.
const row = (text) => screen.getAllByText(text).find(el => el.tagName === 'SPAN' && el.children.length === 0)

// The create form belongs to a chosen type — a node needs one, and "all types" is not
// one. `?type=` carries that choice (ADR-0083), so a test about creating starts there.
function setup({ route = '/explorer' } = {}) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
    if (queryKey[0] === 'nodes') return { data: topicNodes, isLoading: false }
    // Keyed on the id so nothing is "selected" before a row is clicked. The selection
    // is fetched rather than found in the list because the graph re-centres onto
    // neighbours, which are usually of another type.
    if (queryKey[0] === 'node') return { data: queryKey[1] ? topicNodes.find(n => n.id === queryKey[1]) : undefined }
    if (queryKey[0] === 'node-edges') return { data: edges }
    if (queryKey[0] === 'ancestry') return { data: {} }
    if (queryKey[0] === 'relation-options') return { data: [], isLoading: false }
    return { data: [] }
  })
  mockUseMutation.mockImplementation(({ mutationFn, onSuccess }) => ({
    mutate: vi.fn((arg) => { last.arg = arg; last.fn = mutationFn; if (onSuccess) onSuccess(undefined, arg) }),
    isPending: false,
  }))
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes><Route path="/explorer" element={<NodeExplorer />} /></Routes>
    </MemoryRouter>,
  )
}

describe('NodeExplorer', () => {
  it('renders title and node list for the default type', () => {
    setup()
    expect(screen.getByText('nodeExplorer.title')).toBeTruthy()
    expect(row('Roadmap')).toBeTruthy()
    expect(row('Backlog')).toBeTruthy()
  })

  it('defaults to every type rather than whichever one the registry returns first', () => {
    // The old default was `nodeTypes[0]`, which on this database is Cycle: nineteen
    // sprints, and nobody's reason for opening the page. It also meant the list was
    // never a search across the graph, only ever a page of one type.
    setup()
    expect(screen.getByLabelText('nodeExplorer.searchPlaceholder')).toBeTruthy()
    expect(screen.queryByPlaceholderText('nodeExplorer.titlePlaceholder')).toBeNull()
  })

  it('shows a create form once a custom (non-builtin) type is chosen', () => {
    setup({ route: '/explorer?type=topic' })
    expect(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder')).toBeTruthy()
  })

  it('create button is disabled until a title is entered', () => {
    setup({ route: '/explorer?type=topic' })
    const btn = screen.getByText('nodeExplorer.add').closest('button')
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder'), { target: { value: 'New topic' } })
    expect(screen.getByText('nodeExplorer.add').closest('button').disabled).toBe(false)
  })

  it('creates a node with the selected type', () => {
    setup({ route: '/explorer?type=topic' })
    fireEvent.change(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder'), { target: { value: 'New topic' } })
    fireEvent.click(screen.getByText('nodeExplorer.add').closest('button'))
    expect(last.arg).toMatchObject({ type: 'topic', title: 'New topic' })
  })

  it('reports the type total, not the length of the page it drew', () => {
    // The defect this page existed with: it asked for the endpoint's default 100, drew
    // them, and printed that as the count — so 144 tasks read as "100 nodes" and 44 of
    // them could not be reached from here at all.
    setup({ route: '/explorer?type=topic' })
    // Two rows are drawn; the type holds seven. The count says seven.
    expect(screen.getByText('nodeExplorer.countOf:2/7')).toBeTruthy()
  })

  it('selecting a node reveals its edges', () => {
    setup()
    fireEvent.click(row('Roadmap'))
    expect(screen.getByText('nodeExplorer.edges')).toBeTruthy()
    // The relation's own label, not its engine key (ADR-0058) — 'Contains' is also an
    // <option> in the attach picker, so the row is the SPAN one.
    expect(screen.getAllByText('Contains').some(el => el.tagName === 'SPAN')).toBe(true)
  })

  it('names the node at the other end of an edge instead of printing its id', () => {
    setup()
    fireEvent.click(row('Roadmap'))
    expect(screen.getByText('Shard')).toBeTruthy()
    expect(screen.queryByText('p1')).toBeNull()
  })

  it('re-centres on the neighbour when its name is clicked', () => {
    setup()
    fireEvent.click(row('Roadmap'))
    fireEvent.click(screen.getByText('Shard'))
    // The selection followed the edge even though 'p1' is not in the listed type.
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: qk.node('p1') }))
  })
})
