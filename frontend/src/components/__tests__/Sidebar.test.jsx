import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Mock @tanstack/react-query
const mockUseQuery = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
}))

// Mock api/client
vi.mock('../../api/client', () => ({
  getProjects: vi.fn(),
  getIdentities: vi.fn(),
}))

import Sidebar from '../Sidebar'

const mockProjects = [
  { id: 1, name: 'Project Alpha', status: 'active', total_tasks: 5, identities: [] },
  { id: 2, name: 'Project Beta', status: 'active', total_tasks: 3, identities: [] },
  { id: 3, name: 'Old Project', status: 'archived', total_tasks: 0, identities: [] },
]

const mockIdentities = [
  { id: 10, name: 'Work', color: '#ff0000', avatar: 'W' },
]

function setup(options = {}) {
  const { projects = mockProjects, identities = mockIdentities, onOpenPalette = vi.fn() } = options

  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'projects') return { data: projects }
    if (queryKey[0] === 'identities') return { data: identities }
    return { data: [] }
  })

  const utils = render(
    <MemoryRouter initialEntries={['/app']}>
      <Sidebar onOpenPalette={onOpenPalette} />
    </MemoryRouter>
  )

  return { ...utils, onOpenPalette }
}

describe('Sidebar', () => {
  it('renders the brand text "Shard"', () => {
    setup()
    expect(screen.getByText('Shard')).toBeTruthy()
  })

  it('renders nav links for main sections', () => {
    setup()
    expect(screen.getByText('nav.myIssues')).toBeTruthy()
    expect(screen.getByText('nav.identities')).toBeTruthy()
    expect(screen.getByText('nav.integrations')).toBeTruthy()
    expect(screen.getByText('nav.apiKeys')).toBeTruthy()
    expect(screen.getByText('nav.analytics')).toBeTruthy()
    expect(screen.getByText('nav.workflowRules')).toBeTruthy()
    expect(screen.getByText('nav.goals')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })

  it('renders active projects in the sidebar', () => {
    setup()
    expect(screen.getByText('Project Alpha')).toBeTruthy()
    expect(screen.getByText('Project Beta')).toBeTruthy()
  })

  it('renders archived projects in the sidebar', () => {
    setup()
    expect(screen.getByText('Old Project')).toBeTruthy()
    expect(screen.getByText('archived')).toBeTruthy()
  })

  it('shows "no projects yet" when project list is empty', () => {
    setup({ projects: [], identities: [] })
    expect(screen.getByText('nav.noProjectsYet')).toBeTruthy()
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

  it('renders task counts next to projects', () => {
    setup()
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1)
  })

  it('renders project count in section header', () => {
    setup()
    // 2 active projects
    expect(screen.getByText('2')).toBeTruthy()
  })
})
