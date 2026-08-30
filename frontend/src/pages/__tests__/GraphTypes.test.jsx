import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

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
  getFieldVocabulary: vi.fn(),
}))

import GraphTypes from '../GraphTypes'

const nodeTypes = [
  {
    key: 'project', label: 'Project', color: '#818cf8', is_builtin: true, roles: ['container'],
    fields: [{ key: 'title', label: 'Name', kind: 'text', store: 'column' }],
  },
  { key: 'task', label: 'Task', color: '#38bdf8', is_builtin: true, roles: ['task'], fields: [] },
  {
    key: 'topic', label: 'Topic', color: '#abcdef', is_builtin: false, roles: [], usage_count: 4,
    fields: [{ key: 'owner', label: 'Owner', kind: 'text', store: 'data' }],
  },
]
// Served by the registry, never mirrored in the client (ADR-0132).
const vocabulary = {
  managed: ['share_token', 'callback_token'],
  kinds: ['text', 'longtext', 'enum', 'color'],
  stores: ['data', 'column'],
  columns: ['title', 'status', 'priority', 'due_date'],
}
const edgeTypes = [
  { key: 'contains', label: 'Contains', is_builtin: true, is_containment: true, is_symmetric: false },
  { key: 'blocks', label: 'Blocks', is_builtin: false, is_containment: false, is_symmetric: false },
]

const lastMutations = {}

function setup() {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes, isLoading: false }
    if (queryKey[0] === 'edge-types') return { data: edgeTypes, isLoading: false }
    if (queryKey[0] === 'field-vocabulary') return { data: vocabulary, isLoading: false }
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

// `node_types.fields` is what the generic node editor draws (ADR-0074) and was writable
// through both API doors while this page — the one screen about the registry — could not
// touch it. So a custom type could never gain an editable field, and production's own
// `repository` layer carried eight of them undeclared and read-only (ADR-0132).
describe('GraphTypes field declarations', () => {
  const openEditor = () => {
    setup()
    fireEvent.click(screen.getByLabelText('edit topic'))
  }

  it('states how many fields a type declares without opening it', () => {
    setup()
    expect(screen.getAllByText(/graphTypes.fieldsCount/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('graphTypes.fieldsNone').length).toBeGreaterThan(0)
  })

  it('saves a declared field through the type update', () => {
    openEditor()
    fireEvent.click(screen.getByText('graphTypes.fieldAdd'))
    const keys = screen.getAllByLabelText('graphTypes.fieldKey')
    fireEvent.change(keys[keys.length - 1], { target: { value: 'area' } })
    const labels = screen.getAllByLabelText('graphTypes.fieldLabel')
    fireEvent.change(labels[labels.length - 1], { target: { value: 'Area' } })
    fireEvent.click(screen.getByLabelText('save'))

    expect(lastMutations.arg.data.fields).toEqual([
      { key: 'owner', label: 'Owner', kind: 'text', store: 'data' },
      { key: 'area', label: 'Area', kind: 'text', store: 'data' },
    ])
  })

  it('offers the columns as a picker once a field is stored as one', () => {
    // A `column` field naming anything outside WRITABLE_COLUMNS is written into `data`
    // under the same name: it looks saved and the column never changes. A free text box
    // is how you get there, so there isn't one.
    openEditor()
    fireEvent.change(screen.getByLabelText('graphTypes.fieldStore'), { target: { value: 'column' } })
    const key = screen.getByLabelText('graphTypes.fieldKey')
    expect(key.tagName).toBe('SELECT')
    expect([...key.options].map(o => o.value)).toEqual(['', 'title', 'status', 'priority', 'due_date'])
  })

  it('will not save a half-written declaration the server would refuse', () => {
    openEditor()
    fireEvent.click(screen.getByText('graphTypes.fieldAdd'))
    expect(screen.getByLabelText('save')).toBeDisabled()
  })

  it('says so when a declared key belongs to a feature', () => {
    openEditor()
    fireEvent.change(screen.getByLabelText('graphTypes.fieldKey'), { target: { value: 'share_token' } })
    expect(screen.getByText('graphTypes.fieldManaged:share_token')).toBeTruthy()
  })
})
