import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MembershipPanel from '../MembershipPanel'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  useQuery: vi.fn(),
  useQueries: vi.fn(() => []),
  getProjects: vi.fn(),
  getNodeTypes: vi.fn(),
  getNode: vi.fn(),
  getNodes: vi.fn(),
  addTaskMembership: vi.fn(() => Promise.resolve()),
  removeTaskMembership: vi.fn(() => Promise.resolve()),
  attachNodeEdge: vi.fn(() => Promise.resolve()),
  detachNodeEdge: vi.fn(() => Promise.resolve()),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useQueries: (...args) => mocks.useQueries(...args),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getProjects: mocks.getProjects,
  getNodeTypes: mocks.getNodeTypes,
  getNode: mocks.getNode,
  getNodes: mocks.getNodes,
  addTaskMembership: mocks.addTaskMembership,
  removeTaskMembership: mocks.removeTaskMembership,
  attachNodeEdge: mocks.attachNodeEdge,
  detachNodeEdge: mocks.detachNodeEdge,
}))

const projects = [
  { id: 'pA', name: 'Alpha' },
  { id: 'pB', name: 'Beta' },
  { id: 'pC', name: 'Gamma' },
]

function mockQueries({ nodeTypes = [] } = {}) {
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'node-types') return { data: nodeTypes }
    if (queryKey[0] === 'node-search') return { data: [], isFetching: false }
    return { data: projects }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useQueries.mockReturnValue([])
  mockQueries()
})

const task = { id: 't1', project_ids: ['pA', 'pB'] }

describe('MembershipPanel', () => {
  it('lists memberships and marks the current project', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    expect(screen.getByText(/Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Beta/)).toBeInTheDocument()
    // The current project chip is annotated; Beta (secondary) is not.
    expect(screen.getByText(/Alpha.*membership\.thisProject/)).toBeInTheDocument()
  })

  it('only offers projects that are not already linked and not the current one', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Gamma')
    expect(options).not.toContain('Alpha')
    expect(options).not.toContain('Beta')
  })

  it('unlinks a secondary membership', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    fireEvent.click(screen.getByLabelText('unlink Beta'))
    expect(mocks.removeTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pB')
  })

  it('can unlink the current project too (no primary, ADR-0032)', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    fireEvent.click(screen.getByLabelText('unlink Alpha'))
    expect(mocks.removeTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pA')
  })

  it('links the task into another project', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pC' } })
    fireEvent.click(screen.getByText('membership.link'))
    expect(mocks.addTaskMembership).toHaveBeenCalledWith('pA', 't1', 'pC')
  })

  it('hides the container section when no custom container types exist', () => {
    render(<MembershipPanel projectId="pA" task={task} />)
    expect(screen.queryByText('membership.containers')).not.toBeInTheDocument()
  })

  it('shows custom container chips and unlinks them via the node-edge API (ADR-0037)', () => {
    mockQueries({ nodeTypes: [{ key: 'topic', label: 'Topic', is_container: true, color: '#f59e0b' }] })
    mocks.useQueries.mockReturnValue([{ data: { id: 'c1', type: 'topic', title: 'Research' } }])
    const withContainer = { ...task, container_ids: ['pA', 'pB', 'c1'] }
    render(<MembershipPanel projectId="pA" task={withContainer} />)
    expect(screen.getByText('membership.containers')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('unlink container Research'))
    expect(mocks.detachNodeEdge).toHaveBeenCalledWith('c1', 't1', 'contains')
  })
})
