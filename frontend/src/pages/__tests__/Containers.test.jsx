import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k) }),
}))

const mockUseQuery = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
}))
vi.mock('../../api/client', () => ({ getNodeTypes: vi.fn() }))

import Containers from '../Containers'

function setup(nodeTypes, isLoading = false) {
  mockUseQuery.mockReturnValue({ data: nodeTypes, isLoading })
  return render(
    <MemoryRouter>
      <Containers />
    </MemoryRouter>
  )
}

const TYPES = [
  { key: 'area', label: 'Areas', roles: ['container'], is_builtin: false, color: '#22c55e', usage_count: 6 },
  { key: 'topic', label: 'Topics', roles: ['container'], is_builtin: false, color: '#f59e0b', usage_count: 0 },
  { key: 'project', label: 'Project', roles: ['container'], is_builtin: true, usage_count: 12 },
  { key: 'note', label: 'Note', roles: [], is_builtin: false, usage_count: 3 },
]

describe('Containers', () => {
  it('lists custom container types and links each to its own listing', () => {
    setup(TYPES)
    expect(screen.getByText('Areas').closest('a').getAttribute('href')).toBe('/t/area')
    expect(screen.getByText('Topics').closest('a').getAttribute('href')).toBe('/t/topic')
  })

  // Built-ins have their own nav entries and plain types are not containers,
  // so neither belongs on this page — same rule the rail used to apply.
  it('leaves out built-in containers and non-container types', () => {
    setup(TYPES)
    expect(screen.queryByText('Project')).toBeNull()
    expect(screen.queryByText('Note')).toBeNull()
  })

  it('shows each type node count from the registry', () => {
    setup(TYPES)
    expect(screen.getByText('containers.nodeCount:{"count":6}')).toBeTruthy()
    expect(screen.getByText('containers.nodeCount:{"count":0}')).toBeTruthy()
  })

  it('offers a route to type management when there is nothing to list', () => {
    setup([{ key: 'project', label: 'Project', roles: ['container'], is_builtin: true }])
    expect(screen.getByText('containers.empty')).toBeTruthy()
    expect(screen.getByText('containers.manageTypes').closest('a').getAttribute('href')).toBe('/graph-types')
  })
})
