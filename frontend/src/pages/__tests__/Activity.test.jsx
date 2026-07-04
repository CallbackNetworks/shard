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

// Mock useBreakpoint
vi.mock('../../hooks/useBreakpoint', () => ({
  default: () => 'desktop',
}))

// Mock @tanstack/react-query
const mockUseQuery = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
}))

// Mock api/client
vi.mock('../../api/client', () => ({
  getActivity: vi.fn(),
  getProjects: vi.fn(),
}))

import Activity from '../Activity'

const mockProjects = [
  { id: 1, name: 'Project A', status: 'active' },
]

const mockActivities = [
  { id: 1, action: 'task.created', detail: 'Created task: Write tests', project_id: 1, actor: 'user1', created_at: new Date().toISOString() },
  { id: 2, action: 'project.created', detail: 'Created project', project_id: 1, actor: 'user1', created_at: new Date().toISOString() },
  { id: 3, action: 'comment.created', detail: 'Added comment', project_id: 1, actor: 'user1', created_at: new Date().toISOString() },
]

function setup(options = {}) {
  const { activities = mockActivities, projects = mockProjects, isLoading = false } = options

  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'projects') return { data: projects, isLoading: false }
    if (queryKey[0] === 'activity') return { data: activities, isLoading }
    return { data: [], isLoading: false }
  })

  return render(
    <MemoryRouter>
      <Activity />
    </MemoryRouter>
  )
}

describe('Activity', () => {
  it('renders the activity title', () => {
    setup()
    expect(screen.getByText('activity.title')).toBeTruthy()
  })

  it('renders all action type filter chips', () => {
    setup()
    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.getByText('Tasks')).toBeTruthy()
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(screen.getByText('Comments')).toBeTruthy()
    expect(screen.getByText('Share')).toBeTruthy()
    expect(screen.getByText('Rules')).toBeTruthy()
  })

  it('renders activity entries', () => {
    setup()
    expect(screen.getByText('Created task: Write tests')).toBeTruthy()
    expect(screen.getByText('Created project')).toBeTruthy()
    expect(screen.getByText('Added comment')).toBeTruthy()
  })

  it('renders view mode toggles', () => {
    setup()
    expect(screen.getByText('activity.view.log')).toBeTruthy()
    expect(screen.getByText('activity.view.timeline')).toBeTruthy()
    expect(screen.getByText('activity.view.wall')).toBeTruthy()
  })

  it('switches to timeline view', () => {
    setup()
    fireEvent.click(screen.getByText('activity.view.timeline'))
    expect(screen.getAllByTitle('task.created / Created task: Write tests').length).toBeGreaterThan(0)
  })

  it('switches to wall view', () => {
    setup()
    fireEvent.click(screen.getByText('activity.view.wall'))
    expect(screen.getByText('task')).toBeTruthy()
    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.getByText('comment')).toBeTruthy()
  })

  it('filters activities when a filter chip is clicked', () => {
    setup()
    // Click Tasks chip to filter
    fireEvent.click(screen.getByText('Tasks'))
    // Only task.* actions should remain visible
    expect(screen.getByText('Created task: Write tests')).toBeTruthy()
    expect(screen.queryByText('Created project')).toBeNull()
    expect(screen.queryByText('Added comment')).toBeNull()
  })

  it('shows all activities when "All" chip is clicked after filtering', () => {
    setup()
    fireEvent.click(screen.getByText('Tasks'))
    fireEvent.click(screen.getByText('All'))
    expect(screen.getByText('Created task: Write tests')).toBeTruthy()
    expect(screen.getByText('Created project')).toBeTruthy()
  })

  it('renders pagination buttons', () => {
    setup()
    expect(screen.getByText('previous')).toBeTruthy()
    expect(screen.getByText('next')).toBeTruthy()
  })

  it('shows loading state', () => {
    setup({ isLoading: true })
    expect(screen.getByText('loading')).toBeTruthy()
  })

  it('shows empty state when no activities', () => {
    setup({ activities: [] })
    expect(screen.getByText('activity.noActivity')).toBeTruthy()
  })

  it('renders the project filter dropdown', () => {
    setup()
    expect(screen.getByText('activity.allProjects')).toBeTruthy()
  })

  it('disables previous button on first page', () => {
    setup()
    const prevButton = screen.getByText('previous').closest('button')
    expect(prevButton).toBeDisabled()
  })
})
