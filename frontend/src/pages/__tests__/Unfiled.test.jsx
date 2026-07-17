import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
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
  getUnfiledTasks: vi.fn(), fileTaskIntoProject: vi.fn(), getProjects: vi.fn(),
}))

import Unfiled from '../Unfiled'

const tasks = [
  { id: 't1', title: 'Investigate flaky test', status: 'todo', project_id: null, project_ids: [] },
]
const projects = [
  { id: 'p1', name: 'Platform', status: 'active' },
  { id: 'p2', name: 'Archived one', status: 'archived' },
]
const last = {}

function setup(options = {}) {
  const taskData = options.tasks ?? tasks
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'unfiled-tasks') return { data: taskData, isLoading: false }
    if (queryKey[0] === 'projects') return { data: projects, isLoading: false }
    return { data: [] }
  })
  mockUseMutation.mockImplementation(({ onSuccess }) => ({
    mutate: vi.fn((arg) => { last.arg = arg; if (onSuccess) onSuccess() }),
    isPending: false,
  }))
  return render(<MemoryRouter><Unfiled /></MemoryRouter>)
}

describe('Unfiled', () => {
  it('renders title and the unfiled task', () => {
    setup()
    expect(screen.getByText('unfiled.title')).toBeTruthy()
    expect(screen.getByText('Investigate flaky test')).toBeTruthy()
  })

  it('offers only active projects in the file picker', () => {
    setup()
    expect(screen.getByText('Platform')).toBeTruthy()
    expect(screen.queryByText('Archived one')).toBeNull()
  })

  it('file button is disabled until a project is chosen', () => {
    setup()
    expect(screen.getByText('unfiled.file').closest('button').disabled).toBe(true)
  })

  it('files a task into the chosen project', () => {
    setup()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } })
    fireEvent.click(screen.getByText('unfiled.file').closest('button'))
    expect(last.arg).toEqual({ taskId: 't1', projectId: 'p1' })
  })

  it('shows an empty state when nothing is unfiled', () => {
    setup({ tasks: [] })
    expect(screen.getByText('unfiled.empty')).toBeTruthy()
  })
})
