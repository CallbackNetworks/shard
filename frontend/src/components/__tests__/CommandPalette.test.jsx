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
import { NAV_GROUPS } from '../../constants/nav'
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
// Rows are matched on role, not on a style string: they are real buttons.
function rowLabels(container) {
  return Array.from(container.querySelectorAll('[role="option"]'))
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

  // The palette used to carry a hand-written list of four destinations, so
  // goals, decisions, analytics, activity, settings and the whole Graph group
  // were in the rail and unreachable from search. The rail's module list is now
  // the single source, and this fails if the palette grows its own copy again.
  it('offers every destination the rail does', () => {
    const { container } = setup({ mode: 'all' })
    const offered = rowLabels(container)
    const railKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i.labelKey))

    expect(railKeys.length).toBeGreaterThan(4)
    expect(railKeys.filter(key => !offered.includes(key))).toEqual([])
  })

  it('navigates to a rail destination chosen from the palette', () => {
    const { container } = setup({ mode: 'all' })
    const goals = [...container.querySelectorAll('[role="option"]')]
      .find(el => el.children[1]?.textContent.trim() === 'nav.goals')

    fireEvent.click(goals)

    expect(navigate).toHaveBeenCalledWith('/goals')
  })

  // A keyboard-first surface whose rows are unreachable by Tab is only
  // keyboard-first for the person who wrote the arrow-key loop.
  it('renders result rows as focusable controls', () => {
    const { container } = setup({ mode: 'all' })
    const rows = [...container.querySelectorAll('[role="option"]')]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(el => el.tagName === 'BUTTON')).toBe(true)
  })

  // `c` pressed away from a project asks "in which project?"; the answer has to
  // arrive still carrying the intent, or the keystroke just navigates.
  it('carries a new-task intent onto the project it lands on', () => {
    render(<CommandPalette open onClose={vi.fn()} mode="projects" intent="new-task" />)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/projects\/\w+\?new=task$/))
  })

  it('does not add the intent when there is none', () => {
    render(<CommandPalette open onClose={vi.fn()} mode="projects" />)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(navigate).toHaveBeenCalledWith(expect.not.stringContaining('new=task'))
  })
})
