import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts && 'n' in opts ? `${k}:${opts.n}` : k),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, useParams: () => ({ id: 'c1' }) }
})

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
  useMutation: (...args) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../../api/client', () => ({
  getNode: vi.fn(), getNodeTypes: vi.fn(), getContainedTasks: vi.fn(),
  updateTask: vi.fn(), deleteTask: vi.fn(),
}))

// The heavy dnd-based views are not under test here; replace them with probes.
vi.mock('../../components/BoardView', () => ({
  default: ({ tasks }) => <div data-testid="board-view">{tasks.length}</div>,
}))
vi.mock('../../components/TableView', () => ({
  default: ({ tasks, onUpdate }) => (
    <div data-testid="table-view">
      {tasks.map(x => (
        <button key={x.id} onClick={() => onUpdate(x.id, { status: 'done' })}>{x.title}</button>
      ))}
    </div>
  ),
}))

import ContainerView from '../ContainerView'

const node = { id: 'c1', type: 'topic', title: 'Research' }
const nodeTypes = [{ key: 'topic', label: 'Topic', is_container: true, color: '#f59e0b' }]
const tasks = [
  { id: 't1', title: 'With project', status: 'todo', project_id: 'pA' },
  { id: 't2', title: 'Unfiled task', status: 'todo', project_id: null },
]

const last = {}

function setup({ taskList = tasks } = {}) {
  mockUseQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node') return { data: node, isLoading: false, isError: false }
    if (queryKey[0] === 'contained-tasks') return { data: taskList }
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    return { data: [] }
  })
  mockUseMutation.mockImplementation(({ mutationFn, onSuccess }) => ({
    mutate: vi.fn((arg) => { last.arg = arg; last.fn = mutationFn; if (onSuccess) onSuccess(undefined, arg) }),
    isPending: false,
  }))
  return render(<MemoryRouter><ContainerView /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('ContainerView', () => {
  it('renders the container header with type label and task count', () => {
    setup()
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('Topic')).toBeInTheDocument()
    expect(screen.getByText('containerView.count:2')).toBeInTheDocument()
  })

  it('defaults to the table view and switches to board', () => {
    setup()
    expect(screen.getByTestId('table-view')).toBeInTheDocument()
    fireEvent.click(screen.getByText('containerView.view.board'))
    expect(screen.getByTestId('board-view')).toBeInTheDocument()
  })

  it('routes task updates through the task compat project_id', () => {
    setup()
    fireEvent.click(screen.getByText('With project'))
    expect(last.arg).toEqual({ projectId: 'pA', taskId: 't1', data: { status: 'done' } })
  })

  it('ignores updates for tasks without any project membership', () => {
    setup()
    last.arg = null
    fireEvent.click(screen.getByText('Unfiled task'))
    expect(last.arg).toBeNull()
  })

  it('shows the empty state when the container has no tasks', () => {
    setup({ taskList: [] })
    expect(screen.getByText('containerView.empty')).toBeInTheDocument()
  })
})
