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
  updateNodeType: vi.fn(),
  deleteNodeType: vi.fn(),
  getEdgeTypes: vi.fn(),
  createEdgeType: vi.fn(),
  deleteEdgeType: vi.fn(),
}))

import GraphTypes from '../GraphTypes'

const nodeTypes = [
  { key: 'project', label: 'Project', color: '#818cf8', is_builtin: true, roles: ['container'] },
  { key: 'task', label: 'Task', color: '#38bdf8', is_builtin: true, roles: ['task'] },
  { key: 'topic', label: 'Topic', color: '#abcdef', is_builtin: false, roles: [], usage_count: 4 },
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
    // roleContainer/roleTask each appear as a badge and as a node create-form checkbox label.
    expect(screen.getAllByText('graphTypes.roleContainer').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('graphTypes.roleTask').length).toBeGreaterThanOrEqual(2)
    // Appears as a badge on the "contains" edge and as the edge create-form checkbox label.
    expect(screen.getAllByText('graphTypes.roleContainment').length).toBeGreaterThanOrEqual(1)
  })

  it('creates a custom container type when the checkbox is ticked (ADR-0034)', () => {
    setup()
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.keyPlaceholder')[0], { target: { value: 'workspace' } })
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.labelPlaceholder')[0], { target: { value: 'Workspace' } })
    // The node create form's container checkbox is the first roleContainer label with a checkbox.
    const containerCheckboxes = screen.getAllByText('graphTypes.roleContainer')
      .map(el => el.closest('label')?.querySelector('input[type=checkbox]'))
      .filter(Boolean)
    fireEvent.click(containerCheckboxes[0])
    fireEvent.click(screen.getAllByText('graphTypes.add')[0].closest('button'))
    expect(lastMutations.arg).toMatchObject({ key: 'workspace', label: 'Workspace', roles: ['container'] })
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

  it('creates a custom task-like type when the checkbox is ticked (ADR-0035)', () => {
    setup()
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.keyPlaceholder')[0], { target: { value: 'ticket' } })
    fireEvent.change(screen.getAllByPlaceholderText('graphTypes.labelPlaceholder')[0], { target: { value: 'Ticket' } })
    const taskCheckboxes = screen.getAllByText('graphTypes.roleTask')
      .map(el => el.closest('label')?.querySelector('input[type=checkbox]'))
      .filter(Boolean)
    fireEvent.click(taskCheckboxes[0])
    fireEvent.click(screen.getAllByText('graphTypes.add')[0].closest('button'))
    expect(lastMutations.arg).toMatchObject({ key: 'ticket', label: 'Ticket', roles: ['task'] })
  })

  it('shows usage counts for types in use (ADR-0037)', () => {
    setup()
    expect(screen.getByText('graphTypes.usage')).toBeTruthy()
  })

  it('edits a custom node type inline (ADR-0037)', () => {
    setup()
    fireEvent.click(screen.getByLabelText('edit topic'))
    const labelInput = screen.getByLabelText('graphTypes.labelPlaceholder')
    fireEvent.change(labelInput, { target: { value: 'Topics' } })
    fireEvent.click(screen.getByLabelText('save'))
    expect(lastMutations.arg).toMatchObject({ key: 'topic', data: expect.objectContaining({ label: 'Topics' }) })
  })

  it('built-in types have no edit affordance', () => {
    setup()
    expect(screen.queryByLabelText('edit project')).toBeNull()
    expect(screen.queryByLabelText('edit task')).toBeNull()
  })
})
