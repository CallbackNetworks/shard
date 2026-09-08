import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts ? `${k}:${Object.values(opts).join('/')}` : k),
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
  getNodeFacets: vi.fn(), getEdgeCounts: vi.fn(),
}))

import NodeExplorer from '../NodeExplorer'
import { qk } from '../../api/queryKeys'
import { getNodes } from '../../api/client'

const nodeTypes = [
  { key: 'topic', label: 'Topic', is_builtin: false, roles: [], usage_count: 7 },
  { key: 'project', label: 'Project', is_builtin: true, roles: ['container'], usage_count: 9 },
]
const edgeTypes = [{ key: 'contains', label: 'Contains', is_builtin: true, is_containment: true, is_symmetric: false }]
const topicNodes = [
  { id: 'n1', type: 'topic', title: 'Roadmap', status: 'todo', updated_at: '2026-09-01T00:00:00' },
  { id: 'n2', type: 'topic', title: 'Backlog', status: null, updated_at: '2026-09-02T00:00:00' },
]
// `EdgeOut` embeds each endpoint (`source`/`target`) precisely so a client need not
// resolve the id it is handed. This panel printed the id anyway.
const edges = [{
  id: 'e1', source_id: 'n1', target_id: 'p1', rel_type: 'contains',
  source: { id: 'n1', type: 'topic', title: 'Roadmap' },
  target: { id: 'p1', type: 'project', title: 'Shard' },
}]
const facets = { total: 7, status: [{ value: 'todo', count: 5 }, { value: null, count: 2 }], loose: 6 }

const last = {}
const queries = {}

// A row is a title plus a status dot plus the strip saying where the node lives, so
// several nested elements carry the same text; the assertions want the innermost.
const row = (text) => {
  const all = screen.getAllByText(text)
  return all.find(el => !all.some(other => other !== el && el.contains(other)))
}

// The create form belongs to a chosen type — a node needs one, and "all types" is not
// one. `?type=` carries that choice (ADR-0083), so a test about creating starts there.
function setup({ route = '/explorer', nodes = topicNodes } = {}) {
  for (const k of Object.keys(queries)) delete queries[k]
  mockUseQuery.mockImplementation((opts) => {
    const { queryKey } = opts
    queries[queryKey[0]] = opts
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes }
    if (queryKey[0] === 'nodes') return { data: nodes, isLoading: false }
    if (queryKey[0] === 'node-facets') return { data: facets }
    if (queryKey[0] === 'edge-counts') return { data: { n1: 3, n2: 0 } }
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
  // Call history only — `mockReset` would drop the implementations `setup` installs.
  beforeEach(() => { vi.clearAllMocks() })

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

  it('shows a create form once a type is chosen', () => {
    setup({ route: '/explorer?type=topic' })
    expect(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder')).toBeTruthy()
  })

  it('offers create and delete for a built-in type too', () => {
    // The page hid both behind `is_builtin` under a comment claiming built-ins reject a
    // generic create/delete. They do not: `POST /nodes` and `DELETE /nodes/{id}` are the
    // write surface for every first-class entity (ADR-0040→0043) and the delete runs the
    // full teardown (ADR-0131). The cost of the wrong guess was that `?loose=1` could
    // show you orphaned built-ins and nothing on the page could clear them.
    setup({ route: '/explorer?type=project' })
    expect(screen.getByPlaceholderText('nodeExplorer.titlePlaceholder')).toBeTruthy()
    expect(screen.getAllByLabelText('delete').length).toBe(topicNodes.length)
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

  it('reports the server-side total, not the length of the page it drew', () => {
    // The defect this page existed with: it asked for the endpoint's default 100, drew
    // them, and printed that as the count — so 144 tasks read as "100 nodes" and 44 of
    // them could not be reached from here at all. `usage_count` fixed that for a bare
    // type and left every narrowed view guessing; the count is a COUNT of the filtered
    // set now, so it survives a search box too.
    setup({ route: '/explorer?type=topic&q=road' })
    expect(screen.getByText('nodeExplorer.countRange:1/2/7')).toBeTruthy()
  })

  it('asks for the recently-updated order by default', () => {
    // The only order was `position, created_at`, so the node you just made sorted last
    // — findable, past the first page, only by already knowing its title.
    setup()
    queries.nodes.queryFn()
    expect(getNodes).toHaveBeenCalledWith('', '', expect.objectContaining({ sort: 'recent', offset: 0 }))
  })

  it('passes the chosen sort and status filter to the server', () => {
    setup({ route: '/explorer?sort=title&status=todo,none' })
    queries.nodes.queryFn()
    expect(getNodes).toHaveBeenCalledWith('', '', expect.objectContaining({ sort: 'title', status: 'todo,none' }))
  })

  it('lists the statuses the data actually holds, including the absent one', () => {
    // Served, never mirrored (ADR-0056): task, project and decision have three different
    // state machines and a custom type has whatever has been written, so there is no
    // fixed list to hardcode. A NULL status is a real state and gets a row of its own.
    setup()
    expect(screen.getByText('todo')).toBeTruthy()
    expect(screen.getByText('nodeExplorer.statusNone')).toBeTruthy()
  })

  it('says how many nodes are loose before you tick the box', () => {
    // It used to be a section of its own — heading, tick box, three-line note — carrying
    // no number, so the only way to learn whether anything was loose was to filter to it.
    // On the one filter whose whole job is to surface what you did not know was there.
    setup()
    const row = screen.getByText('nodeExplorer.looseOnly').closest('label')
    expect(row.textContent).toContain('6')
    expect(row.querySelector('input[type=checkbox]').checked).toBe(false)
  })

  it('is not made redundant by the edge count on the rows', () => {
    // 21 of this database's 32 loose nodes have exactly one edge — an `owns` from an
    // identity — so they are indistinguishable from healthy nodes in that column, and
    // they are the half worth finding: owned by somebody, filed by nobody.
    setup({ route: '/explorer?loose=1' })
    expect(getNodes).not.toHaveBeenCalled()
    queries.nodes.queryFn()
    expect(getNodes).toHaveBeenCalledWith('', '', expect.objectContaining({ unfiled: true }))
  })

  it('says how many edges each row has', () => {
    // `?loose=1` only finds nodes with nothing above *and* nothing below; a node holding
    // one stray edge is invisible to it, and this is the number that shows it.
    setup()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('files a selection into one container with a single pick', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Roadmap'))
    fireEvent.click(screen.getByLabelText('Backlog'))
    expect(screen.getByText('nodeExplorer.selected:2')).toBeTruthy()
  })

  it('keeps the search text and the selection in the URL', () => {
    // ADR-0083's rule applied to all six controls: `type` and `loose` were in the URL and
    // the two that most distinguish one view from another were component state, so the
    // page could not be linked to or survive a reload.
    setup({ route: '/explorer?q=road&sel=n1' })
    expect(screen.getByLabelText('nodeExplorer.searchPlaceholder').value).toBe('road')
    expect(screen.getByText('nodeExplorer.edges')).toBeTruthy()
  })

  it('selecting a node reveals its edges', () => {
    setup()
    fireEvent.click(row('Roadmap'))
    expect(screen.getByText('nodeExplorer.edges')).toBeTruthy()
    // The relation's own label, not its engine key (ADR-0058) — 'Contains' is also an
    // <option> in the attach picker, so what is asserted is that something other than
    // that option carries it: the group heading the shared panel draws (ADR-0155).
    expect(screen.getAllByText('Contains').some(el => el.tagName !== 'OPTION')).toBe(true)
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
