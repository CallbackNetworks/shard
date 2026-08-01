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

// Registry query for the dynamic container-types group (ADR-0037).
const mockNodeTypes = vi.hoisted(() => ({ data: [] }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockNodeTypes.data }),
}))
vi.mock('../../api/client', () => ({ getNodeTypes: vi.fn() }))

import Sidebar from '../Sidebar'

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
    expect(screen.getByText('nav.language')).toBeTruthy()
  })

  it('renders the status page link', () => {
    setup()
    expect(screen.getByText('nav.statusPage')).toBeTruthy()
  })

  it('shows a dynamic group entry per custom container type (ADR-0037)', () => {
    mockNodeTypes.data = [
      { key: 'topic', label: 'Topics', roles: ['container'], is_builtin: false, color: '#f59e0b' },
      { key: 'project', label: 'Project', roles: ['container'], is_builtin: true },
      { key: 'note', label: 'Note', roles: [], is_builtin: false },
    ]
    setup()
    // Only the custom container type gets an entry — not built-ins, not plain types.
    const link = screen.getByText('Topics').closest('a')
    expect(link.getAttribute('href')).toBe('/t/topic')
    expect(screen.queryByText('Note')).toBeNull()
    mockNodeTypes.data = []
  })

  it('hides the dynamic container group when there are no custom container types', () => {
    setup()
    expect(screen.queryByText('nav.containers')).toBeNull()
  })
})
