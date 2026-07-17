import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.key ? `${k}:${opts.key}` : k),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
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
  getNodeTypes: vi.fn(),
  createNodeType: vi.fn(),
  deleteNodeType: vi.fn(),
  getEdgeTypes: vi.fn(),
  createEdgeType: vi.fn(),
  deleteEdgeType: vi.fn(),
}))

import GraphTypes from '../GraphTypes'

const nodeTypes = [
  { key: 'project', label: 'Project', color: '#818cf8', is_builtin: true, is_container: true, is_task_like: false },
  { key: 'task', label: 'Task', color: '#38bdf8', is_builtin: true, is_container: false, is_task_like: true },
  { key: 'topic', label: 'Topic', color: '#abcdef', is_builtin: false, is_container: false, is_task_like: false },
]
const edgeTypes = [
  { key: 'contains', label: 'Contains', is_builtin: true, is_containment: true, is_symmetric: false },
  { key: 'blocks', label: 'Blocks', is_builtin: false, is_containment: false, is_symmetric: false },
]

const lastMutations = {}

function setup() {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes, isLoading: false }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes, isLoading: false }
    return { data: [], isLoading: false }
  })
  mockUseMutation.mockImplementation(({ mutationFn, onSuccess }) => {
    const mutate = vi.fn((arg) => { lastMutations.arg = arg; if (onSuccess) onSuccess() })
    lastMutations.mutationFn = mutationFn
    return { mutate, isPending: false }
  })
  return render(<MemoryRouter><GraphTypes /></MemoryRouter>)
}

describe('GraphTypes', () => {
  it('renders title and both sections', () => {
    setup()
    expect(screen.getByText('graphTypes.title')).toBeTruthy()
    expect(screen.getByText('graphTypes.nodeTypes')).toBeTruthy()
    expect(screen.getByText('graphTypes.edgeTypes')).toBeTruthy()
  })

  it('lists built-in and custom node types', () => {
    setup()
    expect(screen.getByText('Project')).toBeTruthy()
    expect(screen.getByText('Task')).toBeTruthy()
    expect(screen.getByText('Topic')).toBeTruthy()
  })

  it('shows role badges from the registry', () => {
    setup()
    expect(screen.getByText('graphTypes.roleContainer')).toBeTruthy()
    expect(screen.getByText('graphTypes.roleTask')).toBeTruthy()
    // Appears as a badge on the "contains" edge and as the create-form checkbox label.
    expect(screen.getAllByText('graphTypes.roleContainment').length).toBeGreaterThanOrEqual(1)
  })

  it('lists edge types including custom ones', () => {
    setup()
    expect(screen.getByText('Contains')).toBeTruthy()
    expect(screen.getByText('Blocks')).toBeTruthy()
  })

  it('add button is disabled until key and label are filled', () => {
    setup()
    const addButtons = screen.getAllByText('graphTypes.add')
    expect(addButtons[0].closest('button').disabled).toBe(true)
  })

  it('creates a node type when the form is filled and submitted', () => {
    setup()
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.keyPlaceholder')[0], { target: { value: 'area' } })
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.labelPlaceholder')[0], { target: { value: 'Area' } })
    const addButtons = screen.getAllByText('graphTypes.add')
    fireEvent.click(addButtons[0].closest('button'))
    expect(lastMutations.arg).toMatchObject({ key: 'area', label: 'Area' })
  })
})
