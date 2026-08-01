import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

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
  getNodeTypes: vi.fn(), getEdgeTypes: vi.fn(), getGraphMap: vi.fn(),
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
    if (queryKey[0] === 'node-types') return { data: options.nodeTypes ?? [] }
    if (queryKey[0] === 'edge-types') return { data: options.edgeTypes ?? [] }
    if (queryKey[0] === 'graph-map') return { data: options.graphMap }
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

  it('lists unfiled custom nodes without any containment parent (ADR-0037)', () => {
    setup({
      nodeTypes: [{ key: 'topic', label: 'Topic', is_builtin: false, color: '#f59e0b' }],
      edgeTypes: [
        { key: 'contains', label: 'Contains', is_containment: true },
        { key: 'references', label: 'References', is_containment: false },
      ],
      graphMap: {
        nodes: [
          { id: 'n1', type: 'topic', title: 'Orphan topic' },
          { id: 'n2', type: 'topic', title: 'Contained topic' },
          // Only referenced, not contained — still unfiled.
          { id: 'n3', type: 'topic', title: 'Referenced topic' },
          { id: 'p1', type: 'project', title: 'Some project' },
        ],
        edges: [
          { source_id: 'p1', target_id: 'n2', rel_type: 'contains' },
          { source_id: 'p1', target_id: 'n3', rel_type: 'references' },
        ],
      },
    })
    expect(screen.getByText('unfiled.nodes')).toBeTruthy()
    expect(screen.getByText('Orphan topic')).toBeTruthy()
    expect(screen.getByText('Referenced topic')).toBeTruthy()
    expect(screen.queryByText('Contained topic')).toBeNull()
    // Builtin project node never shows in the custom bucket.
    expect(screen.queryByText('Some project')).toBeNull()
  })

  it('hides the nodes section when every custom node is contained', () => {
    setup({
      nodeTypes: [{ key: 'topic', label: 'Topic', is_builtin: false }],
      edgeTypes: [{ key: 'contains', label: 'Contains', is_containment: true }],
      graphMap: {
        nodes: [{ id: 'n2', type: 'topic', title: 'Contained topic' }],
        edges: [{ source_id: 'p1', target_id: 'n2', rel_type: 'contains' }],
      },
    })
    expect(screen.queryByText('unfiled.nodes')).toBeNull()
  })
})
