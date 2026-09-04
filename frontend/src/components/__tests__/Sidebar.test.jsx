import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
}))

import Sidebar from '../Sidebar'
import { NAV_GROUPS } from '../../constants/nav'

function setup(options = {}) {
  const { onOpenPalette = vi.fn() } = options

  const utils = render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar onOpenPalette={onOpenPalette} />
    </MemoryRouter>
  )

  return { ...utils, onOpenPalette }
}

describe('Sidebar', () => {
  it('renders the brand text', () => {
    setup()
    expect(screen.getByText('SHARD')).toBeTruthy()
  })

  it('renders nav links for main sections', () => {
    setup()
    expect(screen.getByText('nav.commandCenter')).toBeTruthy()
    expect(screen.getByText('nav.identities')).toBeTruthy()
    expect(screen.getByText('nav.integrations')).toBeTruthy()
    expect(screen.getByText('nav.apiKeys')).toBeTruthy()
    expect(screen.getByText('nav.analytics')).toBeTruthy()
    expect(screen.getByText('nav.workflowRules')).toBeTruthy()
    expect(screen.getByText('nav.goals')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })

  it('does not load project data in module navigation', () => {
    setup()
    expect(screen.queryByLabelText('Project signals')).toBeNull()
    expect(screen.queryByText('nav.projects')).toBeNull()
  })

  it('calls onOpenPalette when search button is clicked', () => {
    const onOpenPalette = vi.fn()
    setup({ onOpenPalette })
    const searchButton = screen.getByText('search').closest('button')
    fireEvent.click(searchButton)
    expect(onOpenPalette).toHaveBeenCalledTimes(1)
  })

  it('renders language switcher with EN and Chinese buttons', () => {
    setup()
    expect(screen.getByText('EN')).toBeTruthy()
    expect(screen.getByText('nav.statusPage')).toBeTruthy()
  })

  // ADR-0066: container types are unbounded, so the rail carries one fixed
  // door to their listing rather than one entry per type.
  it('reaches every node, of every type, through a single fixed nav entry', () => {
    // ADR-0066's rule, one level further out (ADR-0150): the DATA group used to spend
    // four rows on four views of one dataset — a container-type menu, an inbox, the type
    // registry and the explorer. Two of those were slices of the third, so the rail
    // charged four permanent lines for what one page answers.
    setup()
    const link = screen.getByText('nav.nodeExplorer').closest('a')
    expect(link.getAttribute('href')).toBe('/explorer')
    expect(screen.queryByText('nav.containers')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.unfiled')).not.toBeInTheDocument()
  })

  // The whole point of the redesign: every rail row is a declared module, so
  // no unbounded collection can push the fixed nav below the fold.
  it('renders exactly the declared nav modules and nothing per-entity', () => {
    const { container } = setup()
    const declared = NAV_GROUPS.reduce((n, g) => n + g.items.length, 0)
    expect(container.querySelectorAll('.kt-mini-nav-button').length).toBe(declared)
  })

  // The module list is the only scrolling row, so the search, the focus
  // control and the bottom actions can never be scrolled out of reach.
  it('scrolls only the module list', () => {
    const { container } = setup()
    const scrollers = container.querySelectorAll('.kt-mini-rail > *')
    expect(Array.from(scrollers).map(el => el.className)).toEqual([
      'kt-mini-brand',
      'kt-mini-search',
      'kt-mini-focus-slot',
      'kt-mini-nav',
      'kt-mini-actions',
    ])
  })
})
