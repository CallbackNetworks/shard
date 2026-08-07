import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import ChildContainersPanel from '../ChildContainersPanel'
import { containerRoute } from '../../utils/containerRoute'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  getContainerSubtree: vi.fn(),
  getNodeTypes: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys pass through with their interpolation values appended so a test can
    // assert on the *numbers* without pinning English copy.
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
}))

vi.mock('../../api/client', () => ({
  getContainerSubtree: mocks.getContainerSubtree,
  getNodeTypes: mocks.getNodeTypes,
}))

const NODE_TYPES = [
  { key: 'project', label: 'Project', color: '#818cf8', is_builtin: true },
  { key: 'area', label: 'Area', color: '#34d399', is_builtin: false },
]

function mockQueries(subtree) {
  mocks.useQuery.mockImplementation(({ queryKey }) => {
    if (queryKey[0] === 'container-subtree') return { data: subtree }
    if (queryKey[0] === 'node-types') return { data: NODE_TYPES }
    return { data: undefined }
  })
}

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ChildContainersPanel nodeId="top" />
    </MemoryRouter>
  )

describe('ChildContainersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the container has no containers below it', () => {
    mockQueries({ id: 'top', children: [], total_tasks: 4, direct_task_count: 4 })
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the subtree is still loading', () => {
    mockQueries(undefined)
    const { container } = renderPanel()
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each child container with the rollup the server computed', () => {
    mockQueries({
      id: 'top',
      children: [
        { id: 'p1', type: 'project', title: 'Inner', total_tasks: 8, done_tasks: 3, progress: 37.5, child_container_count: 0 },
        { id: 'a1', type: 'area', title: 'Deep area', total_tasks: 2, done_tasks: 2, progress: 100, child_container_count: 2 },
      ],
    })
    renderPanel()

    expect(screen.getByText('containers.children:{"count":2}')).toBeInTheDocument()
    expect(screen.getByText('Inner')).toBeInTheDocument()
    // The numbers on screen are the server's, not a re-derivation from visible tasks.
    expect(screen.getByText('containers.tasksDone:{"done":3,"total":8}')).toBeInTheDocument()
    expect(screen.getByText('containers.tasksDone:{"done":2,"total":2}')).toBeInTheDocument()
    // Only the child that has containers of its own advertises them.
    expect(screen.getAllByText(/containers\.deeper/)).toHaveLength(1)
    expect(screen.getByText('containers.deeper:{"count":2}')).toBeInTheDocument()
    // Type badges come from the registry, so a user-defined level is labelled too.
    expect(screen.getByText('Area')).toBeInTheDocument()
  })

  it('links every child to the page that type opens on', () => {
    mockQueries({
      id: 'top',
      children: [
        { id: 'p1', type: 'project', title: 'A project', total_tasks: 0, done_tasks: 0, progress: 0, child_container_count: 0 },
        { id: 'a1', type: 'area', title: 'An area', total_tasks: 0, done_tasks: 0, progress: 0, child_container_count: 0 },
        { id: 'g1', type: 'goal', title: 'A goal', total_tasks: 0, done_tasks: 0, progress: 0, child_container_count: 0 },
      ],
    })
    renderPanel()

    expect(screen.getByText('A project').closest('a')).toHaveAttribute('href', '/projects/p1')
    expect(screen.getByText('An area').closest('a')).toHaveAttribute('href', '/c/a1')
    expect(screen.getByText('A goal').closest('a')).toHaveAttribute('href', '/goals')
  })
})

describe('containerRoute', () => {
  it('sends each container type to the page that can render it', () => {
    expect(containerRoute('x', 'project')).toBe('/projects/x')
    expect(containerRoute('x', 'goal')).toBe('/goals')
    // Any user-defined container type: ContainerView is role-driven, so an
    // unknown key is not a special case.
    expect(containerRoute('x', 'area')).toBe('/c/x')
    expect(containerRoute('x', 'workstream')).toBe('/c/x')
  })
})
