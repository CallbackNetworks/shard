import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, vars) => (vars?.count !== undefined ? `${vars.count} tasks` : k) }),
}))

const navigate = vi.hoisted(() => vi.fn())
const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: pathname.value }),
}))

const data = vi.hoisted(() => ({ projects: [], search: undefined, nodeTypes: [], nodes: [] }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => {
    const key = queryKey[0]
    if (key === 'projects') return { data: data.projects }
    if (key === 'palette-search') return { data: data.search }
    if (key === 'node-types') return { data: data.nodeTypes }
    return { data: data.nodes }
  },
}))
vi.mock('../../api/client', () => ({
  getProjects: vi.fn(), search: vi.fn(), getNodes: vi.fn(), getNodeTypes: vi.fn(),
}))

const focus = vi.hoisted(() => ({ filterProjects: (p) => p }))
vi.mock('../../context/IdentityFocusContext', () => ({ useIdentityFocus: () => focus }))

import CommandPalette from '../CommandPalette'
import { touchProject, forgetProject, getRecentProjectIds } from '../../utils/recentProjects'

const PROJECTS = [
  { id: 'p1', name: 'Alpha', status: 'active', total_tasks: 3 },
  { id: 'p2', name: 'Beta', status: 'active', total_tasks: 0 },
  { id: 'p3', name: 'Gamma', status: 'active', total_tasks: 1 },
  { id: 'p4', name: 'Old Thing', status: 'archived', total_tasks: 9 },
]

function setup({ mode = 'projects' } = {}) {
  const onClose = vi.fn()
  const utils = render(<CommandPalette open onClose={onClose} mode={mode} />)
  return { ...utils, onClose }
}

// Section headings are siblings of the rows, so read the rows in order and
// take each one's label span — not its whole text, which also carries the meta.
function rowLabels(container) {
  return Array.from(container.querySelectorAll('div[style*="cursor: pointer"]'))
    .map(el => el.children[1]?.textContent.trim())
    .filter(Boolean)
}

// jsdom has no layout, so the active row's scroll-into-view is a no-op here.
Element.prototype.scrollIntoView = vi.fn()

beforeEach(() => {
  navigate.mockClear()
  pathname.value = '/'
  getRecentProjectIds().slice().forEach(forgetProject)
  data.projects = PROJECTS
  data.search = undefined
  data.nodeTypes = []
  data.nodes = []
  focus.filterProjects = (p) => p
})

describe('CommandPalette project switcher', () => {
  it('lists only projects in projects mode', () => {
    const { container } = setup()
    const labels = rowLabels(container)
    expect(labels).toContain('Alpha')
    expect(labels).not.toContain('nav.integrations')
    expect(labels).not.toContain('nav.apiKeys')
  })

  // The point of the switcher: the project you were just in is the first thing
  // Enter lands on.
  it('puts recently visited projects first', () => {
    touchProject('p3')
    const { container } = setup()
    expect(rowLabels(container)[0]).toBe('Gamma')
  })

  it('orders several recent projects most-recent-first', () => {
    touchProject('p2')
    touchProject('p3')
    const { container } = setup()
    expect(rowLabels(container).slice(0, 2)).toEqual(['Gamma', 'Beta'])
  })

  it('jumps to the first entry on Enter', () => {
    touchProject('p3')
    setup()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('/projects/p3')
  })

  // Archived projects stay out of the list unless you visited them or type
  // their name — otherwise the switcher fills up with dead work.
  it('hides archived projects that were never visited', () => {
    const { container } = setup()
    expect(rowLabels(container)).not.toContain('Old Thing')
  })

  it('keeps an archived project you were just in', () => {
    touchProject('p4')
    const { container } = setup()
    expect(rowLabels(container)[0]).toBe('Old Thing')
  })

  it('filters by name as you type', () => {
    const { container } = setup()
    fireEvent.change(screen.getByLabelText('palette.switchProject'), { target: { value: 'gam' } })
    expect(rowLabels(container)).toEqual(['Gamma'])
  })

  // A focused identity narrows the rest of the app; the switcher must agree.
  it('respects the identity focus filter', () => {
    focus.filterProjects = (list) => list.filter(p => p.id === 'p1')
    const { container } = setup()
    expect(rowLabels(container)).toEqual(['Alpha'])
  })

  it('does not resurrect a recent project the focus filtered out', () => {
    touchProject('p3')
    focus.filterProjects = (list) => list.filter(p => p.id === 'p1')
    const { container } = setup()
    expect(rowLabels(container)).toEqual(['Alpha'])
  })

  // Landing Enter on the project you are already in makes the fastest path a
  // no-op, so the switcher leaves it out entirely.
  it('omits the project you are currently in', () => {
    pathname.value = '/projects/p3'
    touchProject('p3')
    touchProject('p1')
    const { container } = setup()
    const labels = rowLabels(container)
    expect(labels).not.toContain('Gamma')
    expect(labels[0]).toBe('Alpha')
  })

  it('still offers the current project in the general mode', () => {
    pathname.value = '/projects/p3'
    const { container } = setup({ mode: 'all' })
    expect(rowLabels(container)).toContain('Gamma')
  })

  it('still shows nav commands in the general mode', () => {
    const { container } = setup({ mode: 'all' })
    expect(rowLabels(container)).toContain('nav.apiKeys')
  })
})
