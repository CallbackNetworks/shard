/**
 * The strip that says where a node lives (ADR-0094).
 *
 * Production stores the user's hierarchy as organization → identity → project, and every
 * page that showed one node drew it as a root: the project page named neither, and the
 * identity reached the screen only as an accent colour. These assertions are about what
 * the strip *says* — the order the ancestors are read in, and that ownership is labelled
 * rather than chained, because a chained owner would read as one more level of
 * containment, which is the confusion `contains` and `owns` exist to prevent (ADR-0078).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import AncestryTrail from '../AncestryTrail'

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: (...args) => mocks.useQuery(...args) }))
vi.mock('../../../api/client', () => ({ getAncestry: vi.fn(), getNodeTypes: vi.fn() }))

const NODE_TYPES = [
  { key: 'project', label: 'Project', roles: ['container'] },
  { key: 'organization', label: 'Organization', roles: [] },
  { key: 'identity', label: 'Identity', roles: [] },
]

const ref = (id, type, title, color) => ({ id, type, type_label: type, title, color })

function mockAncestry(entry) {
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'ancestry') return { data: { n1: entry } }
    if (queryKey[0] === 'node-types') return { data: NODE_TYPES }
    return { data: undefined }
  })
}

const renderTrail = () =>
  render(
    <MemoryRouter>
      <AncestryTrail nodeId="n1" />
    </MemoryRouter>
  )

// Braces matter: `mockReset()` returns the mock, and a value returned from
// `beforeEach` is treated as a teardown hook — vitest would then call the mock
// itself with no arguments after every test.
beforeEach(() => { mocks.useQuery.mockReset() })

describe('AncestryTrail', () => {
  it('reads the trail from the outermost ancestor inward', () => {
    mockAncestry({
      id: 'n1',
      trails: [[ref('o1', 'organization', 'CGCG'), ref('i1', 'identity', 'Pipeline dev', '#ff8800')]],
      owners: [],
    })
    renderTrail()
    const chips = screen.getAllByRole('link')
    expect(chips.map(c => c.textContent)).toEqual(['CGCG', 'Pipeline dev'])
  })

  it('links each ancestor to the page that type opens on', () => {
    mockAncestry({
      id: 'n1',
      trails: [[ref('p1', 'project', 'Shard'), ref('c1', 'organization', 'Area 51')]],
      owners: [],
    })
    renderTrail()
    const [project, generic] = screen.getAllByRole('link')
    expect(project.getAttribute('href')).toBe('/projects/p1')
    // A type with no container role has no richer page: it opens on the node page.
    expect(generic.getAttribute('href')).toBe('/n/c1')
  })

  it('labels ownership instead of chaining it onto the trail', () => {
    mockAncestry({ id: 'n1', trails: [], owners: [ref('i1', 'identity', 'Solo creator')] })
    renderTrail()
    expect(screen.getByText('ancestry.ownedBy')).toBeInTheDocument()
    expect(screen.getByRole('link').textContent).toBe('Solo creator')
  })

  it('says how many further trails it is not showing', () => {
    const trail = (title) => [ref(`x-${title}`, 'project', title)]
    mockAncestry({ id: 'n1', trails: [trail('A'), trail('B'), trail('C')], owners: [] })
    renderTrail()
    expect(screen.getByText('ancestry.alsoIn:{"count":1}')).toBeInTheDocument()
  })

  it('renders nothing at all for a node that is nobody\'s and nowhere', () => {
    mockAncestry({ id: 'n1', trails: [], owners: [] })
    const { container } = renderTrail()
    expect(container).toBeEmptyDOMElement()
  })
})
